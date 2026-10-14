export interface GlobalAssumptions {
  investmentAccumulationRate: number;
  investmentDrawdownRate: number;
  dpsAccumulationRate: number;
  dpsDrawdownRate: number;
  includeStateContribution: boolean;
}

export interface MemberInput {
  name: string;
  active: boolean;
  birthYear: number;
  /** Calendar month 1..12; null means unknown. */
  birthMonth: number | null;
  targetMonthlyRent: number;
  monthlyInvestment: number;
  initialInvestment: number;
  oneTimeInvestment: number;
  oneTimeInvestmentYear: number;
  monthlyDps: number;
  initialDps: number;
  dpsDrawdownAge: number;
  dpsDrawdownYears: number;
  rentStartAge: number;
  rentEndAge: number;
  /** Retained for v2/v3 migration only; simulation uses explicit pension date. */
  pensionAge: number;
  pensionStartYear: number;
  pensionStartMonth: number | null;
  monthlyPension: number;
}

export interface CalculatorState {
  assumptions: GlobalAssumptions;
  clientName: string;
  advisorName: string;
  selectedView: 'all' | number;
  members: MemberInput[];
}

export interface CapitalSample {
  month: number;
  investment: number;
  dps: number;
}

export interface MonthlyDraw {
  /** Zero before the requested rent period. */
  target: number;
  investment: number;
  dps: number;
  pension: number;
  dpsUsed: number;
  pensionUsed: number;
  covered: number;
  surplus: number;
  actualIncome: number;
  shortfall: number;
}

export interface SimulationResult {
  samples: CapitalSample[];
  draws: Map<number, MonthlyDraw>;
  capitalAtRentStart: CapitalSample;
  depletedAt: number | null;
  endingInvestment: number;
  endingDps: number;
  totalShortfall: number;
  contributedInvestment: number;
  contributedDps: number;
  receivedStateContribution: number;
  rentStartMonth: number;
  endMonth: number;
  dpsDrawdownStartMonth: number;
  dpsDrawdownEndMonth: number;
  pensionStartMonth: number;
  birthMonth: number;
  monthlyStateContribution: number;
}

export interface ValidationIssue {
  field: keyof MemberInput | keyof GlobalAssumptions | 'scenario';
  message: string;
}
