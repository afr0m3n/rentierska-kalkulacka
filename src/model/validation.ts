import type { GlobalAssumptions, MemberInput, ValidationIssue } from './types';

const MONEY_FIELDS: Array<keyof MemberInput> = [
  'targetMonthlyRent',
  'monthlyInvestment',
  'initialInvestment',
  'oneTimeInvestment',
  'monthlyDps',
  'initialDps',
  'monthlyPension',
];

const AGE_FIELDS: Array<keyof MemberInput> = [
  'dpsDrawdownAge',
  'rentStartAge',
  'rentEndAge',
  'pensionAge',
];

const RATE_FIELDS: Array<keyof GlobalAssumptions> = [
  'investmentAccumulationRate',
  'investmentDrawdownRate',
  'dpsAccumulationRate',
  'dpsDrawdownRate',
];

export function validateAssumptions(assumptions: GlobalAssumptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of RATE_FIELDS) {
    const value = assumptions[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ field, message: 'Výnos musí být platné číslo.' });
    } else if (value <= -100 || value > 100) {
      issues.push({ field, message: 'Výnos musí být větší než −100 % a nejvýše 100 % p.a.' });
    }
  }
  return issues;
}

export function validateMember(member: MemberInput, asOfMonth: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const currentYear = Math.floor(asOfMonth / 12);

  for (const field of MONEY_FIELDS) {
    const value = member[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ field, message: 'Částka musí být platné číslo.' });
    } else if (value < 0) {
      issues.push({ field, message: 'Částka nesmí být záporná.' });
    }
  }

  if (!Number.isInteger(member.birthYear) || member.birthYear < currentYear - 120 || member.birthYear > currentYear) {
    issues.push({ field: 'birthYear', message: `Ročník musí být celé číslo od ${currentYear - 120} do ${currentYear}.` });
  }

  for (const field of AGE_FIELDS) {
    const value = Number(member[field]);
    if (!Number.isInteger(value) || value < 0 || value > 120) {
      issues.push({ field, message: 'Věk musí být celé číslo od 0 do 120 let.' });
    }
  }

  if (!Number.isInteger(member.dpsDrawdownYears) || member.dpsDrawdownYears < 1 || member.dpsDrawdownYears > 60) {
    issues.push({ field: 'dpsDrawdownYears', message: 'Doba čerpání DPS musí být celé číslo od 1 do 60 let.' });
  }

  if (member.rentEndAge <= member.rentStartAge) {
    issues.push({ field: 'rentEndAge', message: 'Konec čerpání musí být později než začátek renty.' });
  }

  const birthMonth = member.birthYear * 12;
  const rentStartMonth = birthMonth + member.rentStartAge * 12;
  const rentEndMonth = birthMonth + member.rentEndAge * 12;
  if (rentStartMonth < asOfMonth) {
    issues.push({ field: 'rentStartAge', message: 'Začátek renty nesmí být v minulosti; probíhající rentu nelze bez historie spolehlivě dopočítat.' });
  }
  if (rentEndMonth <= asOfMonth) {
    issues.push({ field: 'rentEndAge', message: 'Konec čerpání musí ležet v budoucnosti.' });
  }

  const hasDps = member.monthlyDps > 0 || member.initialDps > 0;
  if (hasDps && member.dpsDrawdownAge < 60) {
    issues.push({ field: 'dpsDrawdownAge', message: 'Model standardní výplaty DPS nepovoluje před 60. rokem.' });
  }
  if (hasDps && member.dpsDrawdownAge < member.rentStartAge) {
    issues.push({ field: 'dpsDrawdownAge', message: 'V této etapě musí DPS začít nejdříve se začátkem renty.' });
  }
  if (hasDps && member.dpsDrawdownAge + member.dpsDrawdownYears > member.rentEndAge) {
    issues.push({ field: 'dpsDrawdownYears', message: 'Celá zvolená doba čerpání DPS se musí vejít do období renty.' });
  }

  if (!Number.isInteger(member.oneTimeInvestmentYear)) {
    issues.push({ field: 'oneTimeInvestmentYear', message: 'Rok jednorázového vkladu musí být celé číslo.' });
  } else if (member.oneTimeInvestment > 0) {
    if (member.oneTimeInvestmentYear < currentYear) {
      issues.push({ field: 'oneTimeInvestmentYear', message: 'Minulý vklad patří do dnešního zůstatku investic; rok vkladu nesmí být v minulosti.' });
    }
    const oneTimeMonth = member.oneTimeInvestmentYear === currentYear ? asOfMonth : member.oneTimeInvestmentYear * 12;
    if (oneTimeMonth >= rentStartMonth) {
      issues.push({ field: 'oneTimeInvestmentYear', message: 'Jednorázový vklad musí proběhnout před začátkem renty.' });
    }
  }

  return issues;
}
