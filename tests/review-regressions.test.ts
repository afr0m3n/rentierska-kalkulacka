import { describe, expect, it } from 'vitest';
import { createDefaultMember, DEFAULT_ASSUMPTIONS, calendarMonth, simulate, validateMember,
  MIN_MODELED_PENSION_AGE, annualDraws } from '../src/model';
import { editMemberNumber } from '../src/state/member-edit';
import { parseStoredState } from '../src/state/storage';
import { chartAxisBounds } from '../src/ui/chart-axis';

const NOW = calendarMonth(2026, 10);
const member = () => createDefaultMember(2026, { birthYear: 1990, birthMonth: 10, pensionStartMonth: 10 });

describe('review 1: plausibility of a positive old-age pension', () => {
  it.each([1990, 2016, 2040])('rejects pension starting in October %s before the model minimum', (year) => {
    const candidate = { ...member(), pensionStartYear: year, pensionStartMonth: year === 2040 ? 9 : 10 };
    const issues = validateMember(candidate, NOW);
    expect(issues).toContainEqual(expect.objectContaining({ field: 'pensionStartYear', message: expect.stringContaining('limit kalkulačky') }));
    expect(() => simulate(candidate, DEFAULT_ASSUMPTIONS, NOW)).toThrow(/nikoli potvrzení zákonného nároku/);
  });

  it('accepts the exact model boundary, without claiming statutory entitlement', () => {
    const candidate = { ...member(), pensionStartYear: 1990 + MIN_MODELED_PENSION_AGE, pensionStartMonth: 10 };
    expect(validateMember(candidate, NOW)).toEqual([]);
    expect(simulate(candidate, DEFAULT_ASSUMPTIONS, NOW).pensionStartMonth).toBe(calendarMonth(2040, 10));
  });

  it('does not reject a zero pension solely because of its unused early start', () => {
    expect(validateMember({ ...member(), pensionStartYear: 1990, monthlyPension: 0 }, NOW)).toEqual([]);
  });
});

describe('review 2: suggested versus explicit pension year', () => {
  it('moves the suggestion with younger and older birth years without mutating the original', () => {
    const original = member();
    expect(original.pensionYearSource).toBe('suggested');
    const younger = editMemberNumber(original, 'birthYear', 2000);
    const older = editMemberNumber(original, 'birthYear', 1970);
    expect(younger.pensionStartYear).toBe(2065);
    expect(older.pensionStartYear).toBe(2035);
    expect(original.pensionStartYear).toBe(2055);
    expect(younger.pensionStartMonth).toBe(10);
  });

  it('keeps a manually entered year even when it equals the old suggestion', () => {
    const explicit = editMemberNumber(member(), 'pensionStartYear', 2055);
    expect(explicit.pensionYearSource).toBe('explicit');
    expect(editMemberNumber(explicit, 'birthYear', 2000).pensionStartYear).toBe(2055);
  });

  it('preserves unknown-authorship dates from existing v4 storage', () => {
    const { pensionYearSource: _source, ...old } = member();
    const state = parseStoredState(JSON.stringify({ assumptions: DEFAULT_ASSUMPTIONS, members: [old] }), 2026)!;
    expect(state.members[0]?.pensionYearSource).toBe('explicit');
    expect(editMemberNumber(state.members[0]!, 'birthYear', 2000).pensionStartYear).toBe(2055);
  });

  it.each(['suggested', 'explicit'] as const)('round-trips %s metadata and applies its editing behavior', (source) => {
    const state = parseStoredState(JSON.stringify({ assumptions: DEFAULT_ASSUMPTIONS, members: [{ ...member(), pensionYearSource: source }] }), 2026)!;
    expect(editMemberNumber(state.members[0]!, 'birthYear', 2000).pensionStartYear).toBe(source === 'suggested' ? 2065 : 2055);
  });
});

describe('review 3: complete first and last calendar-year bars', () => {
  it('keeps precise capital months but expands October-to-October income bins', () => {
    const end = calendarMonth(2027, 10);
    const bounds = chartAxisBounds(NOW, end);
    expect(bounds.capital).toEqual({ min: 2026.75, max: 2027.75 });
    expect(bounds.rent).toEqual({ min: 2026, max: 2028 });
    const m = createDefaultMember(2026, { birthYear: 1966, birthMonth: 10, rentStartAge: 60, rentEndAge: 61,
      monthlyDps: 0, monthlyInvestment: 0, pensionStartYear: 2026, pensionStartMonth: 10, monthlyPension: 2000 });
    const results = annualDraws([simulate(m, DEFAULT_ASSUMPTIONS, NOW)]);
    expect(results.get(2026)?.pension).toBeCloseTo(500, 8);
    expect(results.get(2027)?.pension).toBeCloseTo(1500, 8);
    for (const year of results.keys()) {
      expect(year).toBeGreaterThanOrEqual(bounds.rent.min);
      expect(year + 1).toBeLessThanOrEqual(bounds.rent.max);
    }
  });

  it('does not add an empty last year for an exclusive January endpoint', () => {
    expect(chartAxisBounds(NOW, calendarMonth(2028, 1)).rent).toEqual({ min: 2026, max: 2028 });
  });
});
