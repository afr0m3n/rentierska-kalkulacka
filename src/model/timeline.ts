import type { MemberInput } from './types';

export function calendarMonth(year: number, month: number): number {
  return year * 12 + month - 1;
}

export function timeline(member: MemberInput) {
  if (member.birthMonth === null || member.pensionStartMonth === null) throw new RangeError('Doplňte měsíc narození a měsíc začátku důchodu.');
  const birthMonth = calendarMonth(member.birthYear, member.birthMonth);
  return {
    birthMonth,
    rentStartMonth: birthMonth + member.rentStartAge * 12,
    endMonth: birthMonth + member.rentEndAge * 12,
    dpsDrawdownStartMonth: birthMonth + member.dpsDrawdownAge * 12,
    dpsDrawdownEndMonth: birthMonth + (member.dpsDrawdownAge + member.dpsDrawdownYears) * 12,
    pensionStartMonth: calendarMonth(member.pensionStartYear, member.pensionStartMonth),
  };
}

export function currentPragueMonth(date: Date): number {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Prague', year: 'numeric', month: 'numeric' }).formatToParts(date);
  const part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  return calendarMonth(part('year'), part('month'));
}

export function formatMonth(month: number): string {
  return `${month % 12 + 1}/${Math.floor(month / 12)}`;
}
