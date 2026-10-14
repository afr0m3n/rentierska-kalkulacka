import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSUMPTIONS,
  annuityDuePayment,
  createDefaultMember,
  simulate,
  solveRequiredMonthlyInvestment,
  solveSustainableMonthlyRent,
  stateContributionFor,
} from '../src/model';

const JANUARY_2026 = 2026 * 12;
const zeroReturns = {
  ...DEFAULT_ASSUMPTIONS,
  investmentAccumulationRate: 0,
  investmentDrawdownRate: 0,
  dpsAccumulationRate: 0,
  dpsDrawdownRate: 0,
  includeStateContribution: false,
};

describe('stateContributionFor', () => {
  it.each([
    [499, 0], [500, 100], [1_000, 200], [1_700, 340], [5_000, 340],
  ])('maps %s Kč to %s Kč', (contribution, expected) => {
    expect(stateContributionFor(contribution, true)).toBe(expected);
  });

  it('returns zero when disabled', () => {
    expect(stateContributionFor(1_700, false)).toBe(0);
  });
});

describe('annuityDuePayment', () => {
  it('splits principal evenly with a zero return', () => {
    expect(annuityDuePayment(12_000, 0, 12)).toBe(1_000);
  });

  it('amortizes a balance when withdrawal precedes monthly return', () => {
    const payment = annuityDuePayment(120_000, 0.01, 12);
    let balance = 120_000;
    for (let month = 0; month < 12; month += 1) balance = (balance - payment) * 1.01;
    expect(balance).toBeCloseTo(0, 7);
  });
});

describe('simulate', () => {
  it('matches a transparent zero-return reference calculation', () => {
    const member = createDefaultMember(2026, {
      birthYear: 2000,
      rentStartAge: 27,
      rentEndAge: 28,
      targetMonthlyRent: 1_000,
      monthlyInvestment: 1_000,
      monthlyDps: 0,
      initialDps: 0,
      monthlyPension: 0,
      dpsDrawdownAge: 60,
      dpsDrawdownYears: 1,
    });
    const result = simulate(member, zeroReturns, JANUARY_2026);
    expect(result.capitalAtRentStart.investment).toBe(12_000);
    expect(result.contributedInvestment).toBe(12_000);
    expect(result.totalShortfall).toBe(0);
    expect(result.endingInvestment).toBe(0);
  });

  it('includes the current investment balance and a future one-time deposit', () => {
    const member = createDefaultMember(2026, {
      birthYear: 2000,
      rentStartAge: 28,
      rentEndAge: 29,
      targetMonthlyRent: 0,
      monthlyInvestment: 0,
      initialInvestment: 10_000,
      oneTimeInvestment: 5_000,
      oneTimeInvestmentYear: 2027,
      monthlyDps: 0,
      initialDps: 0,
    });
    const result = simulate(member, zeroReturns, JANUARY_2026);
    expect(result.capitalAtRentStart.investment).toBe(15_000);
    expect(result.contributedInvestment).toBe(5_000);
  });

  it('uses the stated nominal rate divided by 12 with deposits at month start', () => {
    const member = createDefaultMember(2026, {
      birthYear: 2000,
      rentStartAge: 27,
      rentEndAge: 28,
      targetMonthlyRent: 0,
      monthlyInvestment: 100,
      monthlyDps: 0,
      initialDps: 0,
    });
    const result = simulate(member, { ...zeroReturns, investmentAccumulationRate: 12 }, JANUARY_2026);
    const reference = 100 * 1.01 * (1.01 ** 12 - 1) / 0.01;
    expect(result.capitalAtRentStart.investment).toBeCloseTo(reference, 8);
  });

  it('pays DPS only inside the selected interval and never tops up later', () => {
    const member = createDefaultMember(2026, {
      birthYear: 1966,
      rentStartAge: 60,
      rentEndAge: 62,
      targetMonthlyRent: 2_000,
      monthlyInvestment: 0,
      initialInvestment: 36_000,
      monthlyDps: 0,
      initialDps: 12_000,
      dpsDrawdownAge: 60,
      dpsDrawdownYears: 1,
      monthlyPension: 0,
    });
    const result = simulate(member, zeroReturns, JANUARY_2026);
    expect(result.draws.get(JANUARY_2026)?.dps).toBe(1_000);
    expect(result.draws.get(JANUARY_2026 + 11)?.dps).toBe(1_000);
    expect(result.draws.get(JANUARY_2026 + 12)?.dps).toBe(0);
    expect(result.endingDps).toBe(0);
    expect(result.totalShortfall).toBe(0);
  });

  it('stops state contributions when modeled state pension starts', () => {
    const member = createDefaultMember(2026, {
      birthYear: 1960,
      rentStartAge: 68,
      rentEndAge: 70,
      pensionAge: 67,
      targetMonthlyRent: 0,
      monthlyInvestment: 0,
      monthlyDps: 1_000,
      initialDps: 0,
      dpsDrawdownAge: 68,
      dpsDrawdownYears: 2,
    });
    const result = simulate(member, { ...zeroReturns, includeStateContribution: true }, JANUARY_2026);
    expect(result.receivedStateContribution).toBe(200 * 12);
    expect(result.contributedDps).toBe(1_000 * 24);
  });
});

describe('solvers', () => {
  const member = createDefaultMember(2026, {
    birthYear: 2000,
    rentStartAge: 27,
    rentEndAge: 28,
    targetMonthlyRent: 1_000,
    monthlyInvestment: 1_000,
    monthlyDps: 0,
    initialDps: 0,
    monthlyPension: 0,
  });

  it('finds required monthly investment for a zero-return reference', () => {
    expect(solveRequiredMonthlyInvestment(member, zeroReturns, JANUARY_2026)).toBeCloseTo(1_000, 2);
  });

  it('finds sustainable rent for a zero-return reference', () => {
    expect(solveSustainableMonthlyRent(member, zeroReturns, JANUARY_2026)).toBeCloseTo(1_000, 2);
  });
});
