import type { CalculatorState, GlobalAssumptions, MemberInput } from './types';

export const DEFAULT_ASSUMPTIONS: GlobalAssumptions = {
  investmentAccumulationRate: 10,
  investmentDrawdownRate: 4,
  dpsAccumulationRate: 7,
  dpsDrawdownRate: 3,
  includeStateContribution: true,
};

export function createDefaultMember(currentYear: number, overrides: Partial<MemberInput> = {}): MemberInput {
  return {
    name: '',
    active: true,
    birthYear: 1990,
    birthMonth: null,
    targetMonthlyRent: 40_000,
    monthlyInvestment: 3_000,
    initialInvestment: 0,
    oneTimeInvestment: 0,
    oneTimeInvestmentYear: currentYear,
    monthlyDps: 1_000,
    initialDps: 0,
    dpsDrawdownAge: 60,
    dpsDrawdownYears: 5,
    rentStartAge: 60,
    rentEndAge: 85,
    pensionAge: 65,
    pensionStartYear: (overrides.birthYear ?? 1990) + (overrides.pensionAge ?? 65),
    pensionStartMonth: null,
    monthlyPension: 20_000,
    ...overrides,
  };
}

export function createDefaultState(currentYear: number): CalculatorState {
  return {
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    clientName: '',
    advisorName: '',
    selectedView: 'all',
    members: [createDefaultMember(currentYear)],
  };
}
