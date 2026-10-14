import type { GlobalAssumptions, MemberInput, SimulationResult } from './types';

export const SHORTFALL_TOLERANCE = 0.01;

export function monthlyRate(nominalAnnualPercent: number): number {
  return nominalAnnualPercent / 1_200;
}

/** Payment at the beginning of each month, followed by that month's return. */
export function annuityDuePayment(principal: number, rate: number, months: number): number {
  if (months <= 0) return principal;
  if (principal <= 0) return 0;
  if (rate === 0) return principal / months;
  return principal * rate / ((1 + rate) * (1 - (1 + rate) ** -months));
}

export function stateContributionFor(monthlyContribution: number, enabled: boolean): number {
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
  const investmentAccumulationRate = monthlyRate(assumptions.investmentAccumulationRate);
  const investmentDrawdownRate = monthlyRate(assumptions.investmentDrawdownRate);
  const dpsAccumulationRate = monthlyRate(assumptions.dpsAccumulationRate);
  const dpsDrawdownRate = monthlyRate(assumptions.dpsDrawdownRate);

  const birthMonth = member.birthYear * 12;
  const rentStartMonth = birthMonth + member.rentStartAge * 12;
  const endMonth = birthMonth + member.rentEndAge * 12;
  const dpsDrawdownStartMonth = birthMonth + member.dpsDrawdownAge * 12;
  const dpsDrawdownEndMonth = dpsDrawdownStartMonth + member.dpsDrawdownYears * 12;
  const pensionStartMonth = birthMonth + member.pensionAge * 12;
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
    if (month === oneTimeMonth && member.oneTimeInvestment > 0) {
      investment += member.oneTimeInvestment;
      contributedInvestment += member.oneTimeInvestment;
    }

    if (month === asOfMonth || month % 12 === 0) {
      samples.push({ month, investment, dps });
    }

    if (month < rentStartMonth) {
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

    const pension = month >= pensionStartMonth
      ? Math.min(member.monthlyPension, member.targetMonthlyRent)
      : 0;
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
    if (shortfall > SHORTFALL_TOLERANCE && depletedAt === null) depletedAt = month;
    totalShortfall += shortfall;
    draws.set(month, { investment: investmentDraw, dps: dpsDraw, pension, shortfall });

    investment = Math.max(0, investment - investmentDraw) * (1 + investmentDrawdownRate);
    dps = Math.max(0, dps - dpsDraw) * (1 + dpsDrawdownRate);
    if (Math.abs(investment) < 1e-8) investment = 0;
    if (Math.abs(dps) < 1e-8) dps = 0;
  }

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
