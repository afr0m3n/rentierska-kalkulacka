import type { GlobalAssumptions, MemberInput } from './types';
import { SHORTFALL_TOLERANCE, simulate } from './simulation';

const MAX_MONTHLY_INVESTMENT = 100_000_000;

function isCovered(member: MemberInput, assumptions: GlobalAssumptions, asOfMonth: number): boolean {
  return simulate(member, assumptions, asOfMonth).totalShortfall <= SHORTFALL_TOLERANCE;
}

export function solveRequiredMonthlyInvestment(
  member: MemberInput,
  assumptions: GlobalAssumptions,
  asOfMonth: number,
): number {
  if (isCovered({ ...member, monthlyInvestment: 0 }, assumptions, asOfMonth)) return 0;
  if (member.birthYear * 12 + member.rentStartAge * 12 <= asOfMonth) return Number.NaN;

  let low = 0;
  let high = 100_000;
  while (!isCovered({ ...member, monthlyInvestment: high }, assumptions, asOfMonth)) {
    high *= 4;
    if (high > MAX_MONTHLY_INVESTMENT) return Number.POSITIVE_INFINITY;
  }
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (isCovered({ ...member, monthlyInvestment: middle }, assumptions, asOfMonth)) high = middle;
    else low = middle;
  }
  return high;
}

export function solveSustainableMonthlyRent(
  member: MemberInput,
  assumptions: GlobalAssumptions,
  asOfMonth: number,
): number {
  let low = 0;
  let high = Math.max(member.targetMonthlyRent * 3, 300_000);
  for (let expansion = 0; expansion < 12; expansion += 1) {
    if (!isCovered({ ...member, targetMonthlyRent: high }, assumptions, asOfMonth)) break;
    high *= 4;
  }
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (isCovered({ ...member, targetMonthlyRent: middle }, assumptions, asOfMonth)) low = middle;
    else high = middle;
  }
  return low;
}
