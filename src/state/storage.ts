import { createDefaultMember, createDefaultState } from '../model/defaults';
import type { CalculatorState, GlobalAssumptions, MemberInput } from '../model/types';

export const STORAGE_KEY = 'rentier-calculator-v4';
export const PREVIOUS_STORAGE_KEY = 'rentier-calculator-v3';
export const LEGACY_STORAGE_KEY = 'rentier-calc-v2';
export const CONSENT_KEY = 'rentier-calculator-local-storage-consent';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Preserve entered numbers (even invalid ones); never substitute unknown dates. */
export function parseStoredState(raw: string | null, currentYear: number): CalculatorState | null {
  try {
    const candidate: unknown = JSON.parse(raw ?? 'null');
    if (!record(candidate) || !Array.isArray(candidate.members) || !candidate.members.length || candidate.members.length > 6) return null;
    const legacy = record(candidate.g);
    const assumptions = legacy ? candidate.g : candidate.assumptions;
    if (!record(assumptions)) return null;
    const aliases: Record<string, string> = { target: 'targetMonthlyRent', monthlyInv: 'monthlyInvestment', oneTime: 'oneTimeInvestment', oneTimeYear: 'oneTimeInvestmentYear', dpsNow: 'initialDps', dpsStart: 'dpsDrawdownAge', dpsYears: 'dpsDrawdownYears', rentStart: 'rentStartAge', endAge: 'rentEndAge', pension: 'monthlyPension' };
    const defaults = createDefaultState(currentYear);
    const members: MemberInput[] = [];
    for (const rawMember of candidate.members) {
      if (!record(rawMember)) return null;
      const data = { ...rawMember };
      if (legacy) for (const [oldKey, newKey] of Object.entries(aliases)) if (oldKey in data) data[newKey] = data[oldKey];
      const member = createDefaultMember(currentYear);
      for (const key of Object.keys(member) as Array<keyof MemberInput>) {
        if (!(key in data)) continue;
        const value = data[key];
        if (key === 'name') member.name = typeof value === 'string' ? value : '';
        else if (key === 'active') member.active = value !== false;
        else if (key === 'birthMonth' || key === 'pensionStartMonth') member[key] = typeof value === 'number' ? value : null;
        else member[key] = typeof value === 'number' ? value : Number.NaN;
      }
      if (!('pensionStartYear' in data)) member.pensionStartYear = member.birthYear + member.pensionAge;
      members.push(member);
    }
    const g = { ...defaults.assumptions };
    const globalAliases: Record<string, keyof GlobalAssumptions> = { invAcc: 'investmentAccumulationRate', invDraw: 'investmentDrawdownRate', dpsAcc: 'dpsAccumulationRate', dpsDraw: 'dpsDrawdownRate', stateContrib: 'includeStateContribution' };
    const values = { ...assumptions };
    if (legacy) for (const [oldKey, newKey] of Object.entries(globalAliases)) values[newKey] = values[oldKey];
    for (const key of Object.keys(g) as Array<keyof GlobalAssumptions>) {
      if (!(key in values)) continue;
      if (key === 'includeStateContribution') g[key] = values[key] === true;
      else g[key] = typeof values[key] === 'number' ? values[key] : Number.NaN;
    }
    const view = legacy ? candidate.view : candidate.selectedView;
    return { ...defaults, assumptions: g, members,
      clientName: typeof (legacy ? candidate.client : candidate.clientName) === 'string' ? String(legacy ? candidate.client : candidate.clientName) : '',
      advisorName: typeof (legacy ? candidate.advisor : candidate.advisorName) === 'string' ? String(legacy ? candidate.advisor : candidate.advisorName) : '',
      selectedView: typeof view === 'number' && Number.isInteger(view) && view >= 0 && view < members.length ? view : 'all' };
  } catch { return null; }
}
