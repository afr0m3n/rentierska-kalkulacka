import { describe, expect, it } from 'vitest';
import { createDefaultMember, validateMember } from '../src/model';

const OCTOBER_2026 = 2026 * 12 + 9;

describe('validateMember', () => {
  it('rejects a rent period ending before it starts', () => {
    const member = createDefaultMember(2026, { rentStartAge: 70, rentEndAge: 65 });
    expect(validateMember(member, OCTOBER_2026).map(({ field }) => field)).toContain('rentEndAge');
  });

  it('rejects rent that already started because historical cash flows are unknown', () => {
    const member = createDefaultMember(2026, { birthYear: 1950, rentStartAge: 65, rentEndAge: 90 });
    expect(validateMember(member, OCTOBER_2026).map(({ field }) => field)).toContain('rentStartAge');
  });

  it('rejects DPS before age 60', () => {
    const member = createDefaultMember(2026, { dpsDrawdownAge: 59 });
    expect(validateMember(member, OCTOBER_2026).map(({ field }) => field)).toContain('dpsDrawdownAge');
  });

  it('rejects a DPS interval extending beyond the modeled rent', () => {
    const member = createDefaultMember(2026, { dpsDrawdownAge: 80, dpsDrawdownYears: 10, rentEndAge: 85 });
    expect(validateMember(member, OCTOBER_2026).map(({ field }) => field)).toContain('dpsDrawdownYears');
  });

  it('rejects a past one-time deposit instead of silently moving it to today', () => {
    const member = createDefaultMember(2026, { oneTimeInvestment: 10_000, oneTimeInvestmentYear: 2025 });
    expect(validateMember(member, OCTOBER_2026).map(({ field }) => field)).toContain('oneTimeInvestmentYear');
  });

  it('rejects blank numeric values represented by NaN', () => {
    const member = createDefaultMember(2026, { monthlyInvestment: Number.NaN });
    expect(validateMember(member, OCTOBER_2026).map(({ field }) => field)).toContain('monthlyInvestment');
  });
});
