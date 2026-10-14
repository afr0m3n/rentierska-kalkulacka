import type { MemberInput } from '../model/types';

export type NumericMemberField = Exclude<keyof MemberInput, 'name' | 'active' | 'pensionYearSource'>;

/** Update only a proposed year; never silently move a user-entered date. */
export function editMemberNumber(member: MemberInput, field: NumericMemberField, value: number): MemberInput {
  const next = { ...member, [field]: value };
  if (field === 'pensionStartYear') next.pensionYearSource = 'explicit';
  if (field === 'birthYear' && member.pensionYearSource === 'suggested') {
    next.pensionStartYear = value + member.pensionAge;
  }
  return next;
}
