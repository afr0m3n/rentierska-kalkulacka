import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS, createDefaultMember, simulate, solveRequiredMonthlyInvestment, solveSustainableMonthlyRent,
  recommendedIncrease, validateMember, validateAssumptions, calendarMonth, currentPragueMonth, annualDraws, capitalAt, commonStartCapital, annuityDuePayment } from '../src/model';
import { parseStoredState } from '../src/state/storage';

const NOW = calendarMonth(2026, 10);
const ZERO = { ...DEFAULT_ASSUMPTIONS, investmentAccumulationRate: 0, investmentDrawdownRate: 0,
  dpsAccumulationRate: 0, dpsDrawdownRate: 0, includeStateContribution: false };
const fixture = (overrides: Parameters<typeof createDefaultMember>[1] = {}) => createDefaultMember(2026, {
  birthYear: 1967, birthMonth: 10, rentStartAge: 60, rentEndAge: 61,
  monthlyInvestment: 100, monthlyDps: 0, monthlyPension: 0, pensionStartMonth: 12, ...overrides,
});

describe('conservative integer recommendations', () => {
  it('rounds required saving 1000.25 up to 1001 and replays without shortfall', () => {
    const m = fixture({ targetMonthlyRent: 1000.25 });
    const required = solveRequiredMonthlyInvestment(m, ZERO, NOW);
    expect(required).toBe(1001);
    expect(simulate(m, ZERO, NOW, { monthlyInvestment: required! }).totalShortfall).toBe(0);
    expect(simulate(m, ZERO, NOW, { monthlyInvestment: 1000 }).totalShortfall).toBeCloseTo(3, 8);
    expect(recommendedIncrease(100.75, required)).toBe(901);
    expect(simulate(m, ZERO, NOW, { monthlyInvestment: 100.75 + recommendedIncrease(100.75, required)! }).totalShortfall).toBe(0);
  });
  it('rounds sustainable rent 1000.75 down to 1000 and replays it', () => {
    const m = fixture({ monthlyInvestment: 1000.75, targetMonthlyRent: 1000 });
    expect(solveSustainableMonthlyRent(m, ZERO, NOW)).toBe(1000);
    expect(simulate(m, ZERO, NOW, { targetMonthlyRent: 1000 }).totalShortfall).toBe(0);
    expect(simulate(m, ZERO, NOW, { targetMonthlyRent: 1001 }).totalShortfall).toBeCloseTo(3, 8);
  });
  it('returns null for unavailable saving and zero for an empty sustainable rent', () => {
    const m = fixture({ birthYear: 1966, monthlyInvestment: 0, targetMonthlyRent: 1000 });
    expect(solveRequiredMonthlyInvestment(m, ZERO, NOW)).toBeNull();
    expect(solveSustainableMonthlyRent(m, ZERO, NOW)).toBe(0);
    expect(recommendedIncrease(0, null)).toBeNull();
  });
});

describe('monthly calendar and actual income', () => {
  it('starts milestones on an October birthday and pension on independent December date', () => {
    const m = fixture({ monthlyPension: 2000, pensionStartYear: 2027, pensionStartMonth: 12, targetMonthlyRent: 1000 });
    const r = simulate(m, ZERO, NOW);
    expect(r.rentStartMonth).toBe(calendarMonth(2027, 10));
    expect(r.draws.get(calendarMonth(2027, 11))?.pension).toBe(0);
    expect(r.draws.get(calendarMonth(2027, 12))).toMatchObject({ pension: 2000, pensionUsed: 1000, surplus: 1000 });
    expect(r.capitalAtRentStart.investment).toBe(1200);
  });
  it('uses Europe/Prague at a UTC month boundary', () => {
    expect(currentPragueMonth(new Date('2026-09-30T22:30:00Z'))).toBe(NOW);
  });
  it('records pension before rent as actual income outside the inactive target', () => {
    const m = fixture({ monthlyPension: 2000, pensionStartYear: 2026, pensionStartMonth: 12, targetMonthlyRent: 1000 });
    const r = simulate(m, ZERO, NOW);
    expect(r.draws.get(calendarMonth(2026, 12))).toMatchObject({ target: 0, pension: 2000, actualIncome: 2000, surplus: 2000, covered: 0 });
    expect(r.capitalAtRentStart.investment).toBe(1200);
  });
  it('shows 10000 DPS income, 1000 used and 9000 surplus without reinvesting', () => {
    const m = fixture({ birthYear: 1966, targetMonthlyRent: 1000, initialDps: 120000, dpsDrawdownYears: 1 });
    const r = simulate(m, ZERO, NOW);
    expect(r.draws.get(NOW)).toMatchObject({ dps: 10000, dpsUsed: 1000, covered: 1000, actualIncome: 10000, surplus: 9000, shortfall: 0, investment: 0 });
    expect(r.endingInvestment).toBe(0);
    expect(r.endingDps).toBe(0);
  });
  it('keeps full pension and DPS, with pension-first attribution and no capital growth from excess', () => {
    const m = fixture({ birthYear: 1966, targetMonthlyRent: 1000, initialInvestment: 100,
      initialDps: 120000, dpsDrawdownYears: 1, monthlyPension: 20000, pensionStartYear: 2026, pensionStartMonth: 10 });
    const r = simulate(m, ZERO, NOW);
    expect(r.draws.get(NOW)).toMatchObject({ pension: 20000, dps: 10000, pensionUsed: 1000, dpsUsed: 0, surplus: 29000, actualIncome: 30000 });
    expect(r.endingInvestment).toBe(100);
  });
});

describe('validation at the public model boundary', () => {
  it.each([NaN, Infinity, -1, 1_000_001])('rejects unsafe monthly input %s', (value) => {
    const m = fixture({ monthlyInvestment: value });
    expect(validateMember(m, NOW).some(({ field }) => field === 'monthlyInvestment')).toBe(true);
    expect(() => simulate(m, ZERO, NOW)).toThrow(RangeError);
  });
  it.each([NaN, Infinity, -100, 31])('rejects unsafe annual rate %s', (value) => {
    const g = { ...ZERO, investmentAccumulationRate: value };
    expect(validateAssumptions(g)).not.toHaveLength(0);
    expect(() => simulate(fixture(), g, NOW)).toThrow(RangeError);
  });
  it('rejects unknown dates, future births, pension beyond horizon and huge modeled balances', () => {
    expect(() => simulate(fixture({ birthMonth: null }), ZERO, NOW)).toThrow();
    expect(() => simulate(fixture({ birthYear: 2026, birthMonth: 12 }), ZERO, NOW)).toThrow();
    expect(() => simulate(fixture({ monthlyPension: 100, pensionStartYear: 2090 }), ZERO, NOW)).toThrow();
    expect(() => simulate(fixture({ birthYear: 2000, rentStartAge: 90, rentEndAge: 120, initialInvestment: 1e9 }), { ...ZERO, investmentAccumulationRate: 30 }, NOW)).toThrow(/numerický/);
  });
  it('stabilizes annuity for tiny and negative returns', () => {
    expect(annuityDuePayment(12000, 1e-12, 12)).toBeCloseTo(1000, 6);
    const rate = -0.005;
    const pay = annuityDuePayment(12000, rate, 12);
    let balance = 12000;
    for (let i = 0; i < 12; i++) balance = (balance - pay) * (1 + rate);
    expect(balance).toBeCloseTo(0, 8);
  });
});

describe('household calendar aggregation', () => {
  it('does not carry capital beyond a member horizon or combine different rent starts', () => {
    const a = simulate(fixture({ birthYear: 1966, initialInvestment: 12000, targetMonthlyRent: 0 }), ZERO, NOW);
    const b = simulate(fixture({ birthYear: 1967, initialInvestment: 24000, targetMonthlyRent: 0 }), ZERO, NOW);
    expect(capitalAt(a, a.endMonth - 1)?.investment).toBe(12000);
    expect(capitalAt(a, a.endMonth)).toBeNull();
    expect(capitalAt(a, b.endMonth - 1)).toBeNull();
    expect(commonStartCapital([a, b])).toBeNull();
  });
  it('averages partial years over all twelve calendar months', () => {
    const a = simulate(fixture({ birthYear: 1966, targetMonthlyRent: 1000, initialInvestment: 12000 }), ZERO, NOW);
    expect(annualDraws([a]).get(2026)?.investment).toBe(250);
    expect(annualDraws([a]).get(2027)?.investment).toBe(750);
  });
});

describe('stored calculations migration', () => {
  it('preserves old values but leaves missing calendar months unknown', () => {
    const original = fixture();
    const { birthMonth: _birth, pensionStartYear: _year, pensionStartMonth: _month, ...old } = original;
    const state = parseStoredState(JSON.stringify({ assumptions: ZERO, members: [old] }), 2026)!;
    expect(state.members[0]?.monthlyInvestment).toBe(100);
    expect(state.members[0]?.birthMonth).toBeNull();
    expect(state.members[0]?.pensionStartMonth).toBeNull();
    expect(state.members[0]?.pensionStartYear).toBe(2032);
    expect(validateMember(state.members[0]!, NOW).length).toBeGreaterThan(0);
  });
  it('supports legacy v2 field aliases without fabricating dates', () => {
    const state = parseStoredState(JSON.stringify({ g: { invAcc: 8, stateContrib: false }, client: 'Test', members: [{ birthYear: 1980, pensionAge: 65, target: 5000, monthlyInv: 1234 }] }), 2026)!;
    expect(state.members[0]).toMatchObject({ birthYear: 1980, birthMonth: null, monthlyInvestment: 1234, targetMonthlyRent: 5000, pensionStartYear: 2045, pensionStartMonth: null });
    expect(state.assumptions.investmentAccumulationRate).toBe(8);
  });
  it('does not turn a persisted invalid null amount into zero or a valid default', () => {
    const state = parseStoredState(JSON.stringify({ assumptions: ZERO, members: [{ ...fixture(), monthlyInvestment: null }] }), 2026)!;
    expect(validateMember(state.members[0]!, NOW).some(({ field }) => field === 'monthlyInvestment')).toBe(true);
    expect(parseStoredState('{broken', 2026)).toBeNull();
  });
});
