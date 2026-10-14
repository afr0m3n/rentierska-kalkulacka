import type { GlobalAssumptions, MemberInput, SimulationResult } from './types';
import { assertValidScenario, MAX_MODELED_BALANCE } from './validation';
import { timeline } from './timeline';

export const SHORTFALL_TOLERANCE = 1e-6;

export function monthlyRate(nominalAnnualPercent: number): number {
  if (!Number.isFinite(nominalAnnualPercent) || nominalAnnualPercent <= -100 || nominalAnnualPercent > 30) throw new RangeError('Neplatná roční sazba.');
  return nominalAnnualPercent / 1_200;
}

/** Payment at the beginning of each month, followed by that month's return. */
export function annuityDuePayment(principal: number, rate: number, months: number): number {
  if (!Number.isFinite(principal) || principal < 0 || !Number.isFinite(rate) || rate <= -1 || !Number.isInteger(months) || months <= 0) throw new RangeError('Neplatné zadání anuity.');
  if (principal === 0) return 0;
  if (rate === 0) return principal / months;
  return principal * rate / ((1 + rate) * -Math.expm1(-months * Math.log1p(rate)));
}

export function stateContributionFor(monthlyContribution: number, enabled: boolean): number {
  if (!Number.isFinite(monthlyContribution) || monthlyContribution < 0 || monthlyContribution > 1_000_000 || typeof enabled !== 'boolean') throw new RangeError('Neplatný měsíční vklad DPS.');
  if (!enabled || monthlyContribution < 500) return 0;
  return Math.min(monthlyContribution, 1_700) * 0.2;
}

export function simulate(
  baseMember: MemberInput,
  assumptions: GlobalAssumptions,
  asOfMonth: number,
  overrides: Partial<MemberInput> = {},
): SimulationResult {
  const member = { ...baseMember, ...overrides };
  assertValidScenario(member, assumptions, asOfMonth);
  const investmentAccumulationRate = monthlyRate(assumptions.investmentAccumulationRate);
  const investmentDrawdownRate = monthlyRate(assumptions.investmentDrawdownRate);
  const dpsAccumulationRate = monthlyRate(assumptions.dpsAccumulationRate);
  const dpsDrawdownRate = monthlyRate(assumptions.dpsDrawdownRate);

  const { birthMonth, rentStartMonth, endMonth, dpsDrawdownStartMonth, dpsDrawdownEndMonth, pensionStartMonth } = timeline(member);
  const currentYear = Math.floor(asOfMonth / 12);
  const oneTimeMonth = member.oneTimeInvestmentYear === currentYear
    ? asOfMonth
    : member.oneTimeInvestmentYear * 12;
  const monthlyStateContribution = stateContributionFor(
    member.monthlyDps,
    assumptions.includeStateContribution,
  );

  let investment = member.initialInvestment;
  let dps = member.initialDps;
  let dpsPayment: number | null = null;
  let capitalAtRentStart: SimulationResult['capitalAtRentStart'] | null = null;
  let depletedAt: number | null = null;
  let totalShortfall = 0;
  let contributedInvestment = 0;
  let contributedDps = 0;
  let receivedStateContribution = 0;
  const samples: SimulationResult['samples'] = [];
  const draws: SimulationResult['draws'] = new Map();

  for (let month = asOfMonth; month < endMonth; month += 1) {
    if (![investment, dps].every((value) => Number.isFinite(value) && value >= 0 && value <= MAX_MODELED_BALANCE)) throw new RangeError('Modelovaný kapitál překročil bezpečný numerický rozsah. Snižte výnos nebo délku modelace.');
    if (month === oneTimeMonth && member.oneTimeInvestment > 0) {
      investment += member.oneTimeInvestment;
      contributedInvestment += member.oneTimeInvestment;
    }

    samples.push({ month, investment, dps });

    if (month < rentStartMonth) {
      const pension = month >= pensionStartMonth ? member.monthlyPension : 0;
      draws.set(month, { target: 0, investment: 0, dps: 0, pension, pensionUsed: 0, dpsUsed: 0,
        covered: 0, actualIncome: pension, surplus: pension, shortfall: 0 });
      const stateContribution = month < pensionStartMonth ? monthlyStateContribution : 0;
      investment += member.monthlyInvestment;
      dps += member.monthlyDps + stateContribution;
      contributedInvestment += member.monthlyInvestment;
      contributedDps += member.monthlyDps;
      receivedStateContribution += stateContribution;
      investment *= 1 + investmentAccumulationRate;
      dps *= 1 + dpsAccumulationRate;
      continue;
    }

    if (capitalAtRentStart === null) {
      capitalAtRentStart = { month, investment, dps };
    }

    const pension = month >= pensionStartMonth ? member.monthlyPension : 0;
    let dpsDraw = 0;
    if (month >= dpsDrawdownStartMonth && month < dpsDrawdownEndMonth && dps > 0) {
      if (dpsPayment === null) {
        dpsPayment = annuityDuePayment(dps, dpsDrawdownRate, dpsDrawdownEndMonth - month);
      }
      dpsDraw = Math.min(dpsPayment, dps);
    }

    const remainingNeed = Math.max(0, member.targetMonthlyRent - pension - dpsDraw);
    const investmentDraw = Math.min(remainingNeed, Math.max(0, investment));
    const shortfall = Math.max(0, remainingNeed - investmentDraw);
    // Pension covers the target first, then DPS. Surplus leaves the model.
    const pensionUsed = Math.min(pension, member.targetMonthlyRent);
    const dpsUsed = Math.min(dpsDraw, Math.max(0, member.targetMonthlyRent - pensionUsed));
    const actualIncome = pension + dpsDraw + investmentDraw;
    if (shortfall > SHORTFALL_TOLERANCE && depletedAt === null) depletedAt = month;
    totalShortfall += shortfall;
    draws.set(month, { target: member.targetMonthlyRent, investment: investmentDraw, dps: dpsDraw, pension, pensionUsed, dpsUsed,
      covered: pensionUsed + dpsUsed + investmentDraw, actualIncome,
      surplus: Math.max(0, actualIncome - member.targetMonthlyRent), shortfall });

    investment = Math.max(0, investment - investmentDraw) * (1 + investmentDrawdownRate);
    dps = Math.max(0, dps - dpsDraw) * (1 + dpsDrawdownRate);
    if (Math.abs(investment) < 1e-8) investment = 0;
    if (Math.abs(dps) < 1e-8) dps = 0;
  }

  if (![investment, dps].every((value) => Number.isFinite(value) && value <= MAX_MODELED_BALANCE)) throw new RangeError('Konečný kapitál překročil bezpečný numerický rozsah.');
  if (capitalAtRentStart === null) {
    capitalAtRentStart = { month: rentStartMonth, investment, dps };
  }
  samples.push({ month: endMonth, investment, dps });

  return {
    samples,
    draws,
    capitalAtRentStart,
    depletedAt,
    endingInvestment: investment,
    endingDps: dps,
    totalShortfall,
    contributedInvestment,
    contributedDps,
    receivedStateContribution,
    rentStartMonth,
    endMonth,
    dpsDrawdownStartMonth,
    dpsDrawdownEndMonth,
    pensionStartMonth,
    birthMonth,
    monthlyStateContribution,
  };
}
