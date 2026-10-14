import type { GlobalAssumptions, MemberInput, ValidationIssue } from './types';
import { calendarMonth } from './timeline';

// Product bounds, not legal entitlement rules. Solver searches use these too.
export const MAX_MONTHLY_AMOUNT = 1_000_000;
export const MAX_CAPITAL_INPUT = 1_000_000_000;
export const MAX_MODELED_BALANCE = 1e15;
const MONTHLY_FIELDS = ['targetMonthlyRent', 'monthlyInvestment', 'monthlyDps', 'monthlyPension'] as const;
const CAPITAL_FIELDS = ['initialInvestment', 'initialDps', 'oneTimeInvestment'] as const;
const AGE_FIELDS = ['dpsDrawdownAge', 'rentStartAge', 'rentEndAge'] as const;
const RATE_FIELDS = ['investmentAccumulationRate', 'investmentDrawdownRate', 'dpsAccumulationRate', 'dpsDrawdownRate'] as const;
const integerIn = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;

export function validateAssumptions(assumptions: GlobalAssumptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of RATE_FIELDS) {
    const value = assumptions[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= -100 || value > 30) {
      issues.push({ field, message: 'Výnos musí být platné číslo větší než −100 % a nejvýše 30 % p.a.' });
    }
  }
  if (typeof assumptions.includeStateContribution !== 'boolean') issues.push({ field: 'includeStateContribution', message: 'Zvolte, zda modelovat státní příspěvek.' });
  return issues;
}

export function validateMember(member: MemberInput, asOfMonth: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!integerIn(asOfMonth, 1900 * 12, 2200 * 12)) return [{ field: 'scenario', message: 'Neplatný referenční měsíc.' }];
  const currentYear = Math.floor(asOfMonth / 12);
  for (const field of [...MONTHLY_FIELDS, ...CAPITAL_FIELDS]) {
    const value = member[field];
    const maximum = (MONTHLY_FIELDS as readonly string[]).includes(field) ? MAX_MONTHLY_AMOUNT : MAX_CAPITAL_INPUT;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
      issues.push({ field, message: 'Částka musí být platné číslo od 0 do ' + maximum.toLocaleString('cs-CZ') + ' Kč.' });
    }
  }
  if (typeof member.name !== 'string' || member.name.length > 200) issues.push({ field: 'name', message: 'Jméno musí být text do 200 znaků.' });
  if (typeof member.active !== 'boolean') issues.push({ field: 'active', message: 'Neplatné zahrnutí osoby do modelace.' });
  if (!integerIn(member.birthYear, currentYear - 120, currentYear)) issues.push({ field: 'birthYear', message: 'Zadejte platný ročník v posledních 120 letech.' });
  if (!integerIn(member.birthMonth, 1, 12)) issues.push({ field: 'birthMonth', message: 'Doplňte skutečný měsíc narození (1–12); u starší kalkulace není znám.' });
  for (const field of AGE_FIELDS) if (!integerIn(member[field], 0, 120)) issues.push({ field, message: 'Věk musí být celé číslo od 0 do 120 let.' });
  if (!integerIn(member.dpsDrawdownYears, 1, 60)) issues.push({ field: 'dpsDrawdownYears', message: 'Doba čerpání DPS musí být celé číslo od 1 do 60 let.' });
  if (!integerIn(member.pensionStartYear, member.birthYear, member.birthYear + 120)) issues.push({ field: 'pensionStartYear', message: 'Rok začátku důchodu musí ležet mezi narozením a 120. rokem života.' });
  if (!integerIn(member.pensionStartMonth, 1, 12)) issues.push({ field: 'pensionStartMonth', message: 'Doplňte měsíc začátku důchodu (1–12); u starší kalkulace není znám.' });
  if (!integerIn(member.oneTimeInvestmentYear, currentYear - 120, currentYear + 120)) issues.push({ field: 'oneTimeInvestmentYear', message: 'Rok vkladu musí být celé číslo v modelovaném časovém rozsahu.' });
  if (member.rentEndAge <= member.rentStartAge) issues.push({ field: 'rentEndAge', message: 'Konec čerpání musí být později než začátek renty.' });
  if (integerIn(member.birthMonth, 1, 12)) {
    const birth = calendarMonth(member.birthYear, member.birthMonth);
    const start = birth + member.rentStartAge * 12;
    const end = birth + member.rentEndAge * 12;
    if (birth > asOfMonth) issues.push({ field: 'birthMonth', message: 'Datum narození nesmí ležet v budoucnosti.' });
    if (start < asOfMonth) issues.push({ field: 'rentStartAge', message: 'Začátek renty nesmí být v minulosti; model nezná historii probíhající renty.' });
    if (end <= asOfMonth) issues.push({ field: 'rentEndAge', message: 'Konec čerpání musí ležet v budoucnosti.' });
    if (member.monthlyPension > 0 && integerIn(member.pensionStartMonth, 1, 12)) {
      const pension = calendarMonth(member.pensionStartYear, member.pensionStartMonth);
      if (pension >= end) issues.push({ field: 'pensionStartYear', message: 'Důchod začíná po konci modelace; upravte datum nebo nastavte částku na 0.' });
      if (pension < birth) issues.push({ field: 'pensionStartMonth', message: 'Důchod nesmí začínat před narozením.' });
    }
    if (member.oneTimeInvestment > 0) {
      const deposit = member.oneTimeInvestmentYear === currentYear ? asOfMonth : member.oneTimeInvestmentYear * 12;
      if (member.oneTimeInvestmentYear < currentYear) issues.push({ field: 'oneTimeInvestmentYear', message: 'Minulý vklad patří do dnešní hodnoty investic.' });
      if (deposit >= start) issues.push({ field: 'oneTimeInvestmentYear', message: 'Jednorázový vklad musí proběhnout před začátkem renty.' });
    }
  }
  const hasDps = member.monthlyDps > 0 || member.initialDps > 0;
  if (hasDps && member.dpsDrawdownAge < 60) issues.push({ field: 'dpsDrawdownAge', message: 'Model standardní výplaty DPS nepovoluje před 60. rokem.' });
  if (hasDps && member.dpsDrawdownAge < member.rentStartAge) issues.push({ field: 'dpsDrawdownAge', message: 'V této etapě musí DPS začít nejdříve se začátkem renty.' });
  if (hasDps && member.dpsDrawdownAge + member.dpsDrawdownYears > member.rentEndAge) issues.push({ field: 'dpsDrawdownYears', message: 'Celá doba čerpání DPS se musí vejít do období renty.' });
  return issues;
}

export function assertValidScenario(member: MemberInput, assumptions: GlobalAssumptions, asOfMonth: number): void {
  const issues = [...validateAssumptions(assumptions), ...validateMember(member, asOfMonth)];
  if (issues.length) throw new RangeError(issues.map(({ message }) => message).join(' '));
}
