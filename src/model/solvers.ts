import type { GlobalAssumptions, MemberInput } from './types';
import { SHORTFALL_TOLERANCE, simulate } from './simulation';
import { assertValidScenario, MAX_MONTHLY_AMOUNT } from './validation';
import { timeline } from './timeline';

const covered = (member: MemberInput, assumptions: GlobalAssumptions, month: number) =>
  simulate(member, assumptions, month).totalShortfall <= SHORTFALL_TOLERANCE;

/** Integer crowns, rounded conservatively and verified by monthly simulation. */
export function solveRequiredMonthlyInvestment(member: MemberInput, assumptions: GlobalAssumptions, month: number): number | null {
  assertValidScenario(member, assumptions, month);
  const enough = (amount: number) => covered({ ...member, monthlyInvestment: amount }, assumptions, month);
  if (enough(0)) return 0;
  if (timeline(member).rentStartMonth <= month) return null;
  let low = 0;
  let high = Math.max(1_000, member.monthlyInvestment);
  while (!enough(high)) {
    if (high === MAX_MONTHLY_AMOUNT) return null;
    low = high;
    high = Math.min(MAX_MONTHLY_AMOUNT, high * 4);
  }
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const middle = (low + high) / 2;
    if (enough(middle)) high = middle;
    else low = middle;
  }
  let rounded = Math.ceil(high);
  while (rounded <= MAX_MONTHLY_AMOUNT && !enough(rounded)) rounded += 1;
  return rounded <= MAX_MONTHLY_AMOUNT ? rounded : null;
}

export function solveSustainableMonthlyRent(member: MemberInput, assumptions: GlobalAssumptions, month: number): number {
  assertValidScenario(member, assumptions, month);
  const enough = (amount: number) => covered({ ...member, targetMonthlyRent: amount }, assumptions, month);
  let low = 0;
  let high = MAX_MONTHLY_AMOUNT;
  if (enough(high)) return high;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const middle = (low + high) / 2;
    if (enough(middle)) low = middle;
    else high = middle;
  }
  let rounded = Math.floor(low);
  while (rounded > 0 && !enough(rounded)) rounded -= 1;
  return rounded;
}

export function recommendedIncrease(current: number, required: number | null): number | null {
  return required === null ? null : Math.ceil(Math.max(0, required - current));
}
