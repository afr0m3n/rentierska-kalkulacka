import type { CapitalSample, MonthlyDraw, SimulationResult } from './types';

export function emptyDraw(): MonthlyDraw {
  return { target: 0, investment: 0, dps: 0, pension: 0, dpsUsed: 0, pensionUsed: 0, covered: 0, surplus: 0, actualIncome: 0, shortfall: 0 };
}

/** End is exclusive: after it the person's assets are outside the model. */
export function capitalAt(result: SimulationResult, month: number): CapitalSample | null {
  if (month < result.samples[0]!.month || month >= result.endMonth) return null;
  return result.samples.find((sample) => sample.month === month) ?? null;
}

export function aggregateDraws(results: SimulationResult[]): Map<number, MonthlyDraw> {
  const monthly = new Map<number, MonthlyDraw>();
  for (const result of results) for (const [month, draw] of result.draws) {
    const total = monthly.get(month) ?? emptyDraw();
    for (const key of Object.keys(total) as Array<keyof MonthlyDraw>) total[key] += draw[key];
    monthly.set(month, total);
  }
  return monthly;
}

/** Calendar-year averages include zero months before/after a person's rent. */
export function annualDraws(results: SimulationResult[]): Map<number, MonthlyDraw> {
  const monthly = aggregateDraws(results);
  const annual = new Map<number, MonthlyDraw>();
  for (const [month, draw] of monthly) {
    const year = Math.floor(month / 12);
    const total = annual.get(year) ?? emptyDraw();
    for (const key of Object.keys(total) as Array<keyof MonthlyDraw>) total[key] += draw[key] / 12;
    annual.set(year, total);
  }
  return annual;
}

export function commonStartCapital(results: SimulationResult[]): number | null {
  if (new Set(results.map((result) => result.rentStartMonth)).size !== 1) return null;
  return results.reduce((sum, result) => sum + result.capitalAtRentStart.investment + result.capitalAtRentStart.dps, 0);
}
