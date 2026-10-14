import { describe, expect, it } from 'vitest';
import { createDefaultState, createDefaultMember, DEFAULT_ASSUMPTIONS, simulate, calendarMonth } from '../src/model';
import { reportHtml } from '../src/pdf/report';

it('includes every financial and calendar input, state support and full cash flow in the report', () => {
  const state = createDefaultState(2026);
  state.assumptions = { ...DEFAULT_ASSUMPTIONS, investmentAccumulationRate: 0, investmentDrawdownRate: 0, dpsAccumulationRate: 0, dpsDrawdownRate: 0 };
  const member = createDefaultMember(2026, { name: 'Fiktivní osoba <test>', birthYear: 1967, birthMonth: 10,
    rentStartAge: 60, rentEndAge: 61, dpsDrawdownAge: 60, dpsDrawdownYears: 1,
    pensionStartYear: 2027, pensionStartMonth: 12, initialInvestment: 123456, initialDps: 234567,
    oneTimeInvestment: 345678, oneTimeInvestmentYear: 2026, targetMonthlyRent: 1000 });
  state.members = [member];
  const month = calendarMonth(2026, 10);
  const result = simulate(member, state.assumptions, month);
  const html = reportHtml(state, [{ member, result, requiredInvestment: 0, sustainableRent: 1000, requiredCapital: 123456 }], month, 'data:image/png;base64,test', 'data:image/png;base64,test');
  for (const text of ['10/1967', '12/2027', 'jednorázový vklad', 'Rok jednorázového vkladu',
    'počáteční hodnota', 'počáteční zůstatek', 'Výnos investic', 'Výnos DPS', 'Státní příspěvek DPS',
    'Z DPS použito na cíl', 'Z důchodu použito na cíl', 'Přebytek nad cílem', 'Schodek do cíle']) expect(html).toContain(text);
  expect(html).toContain('123'); expect(html).toContain('234'); expect(html).toContain('345');
  expect(html).toContain('Fiktivní osoba &lt;test&gt;');
  expect(html).not.toContain('Fiktivní osoba <test>');
});

describe('report unavailable values', () => {
  it('represents unavailable recommendations without NaN or Infinity', () => {
    const state = createDefaultState(2026);
    const member = createDefaultMember(2026, { name: 'Test', birthYear: 1966, birthMonth: 10, pensionStartMonth: 12 });
    const month = calendarMonth(2026, 10);
    const result = simulate(member, state.assumptions, month);
    const html = reportHtml(state, [{ member, result, requiredInvestment: null, sustainableRent: 0, requiredCapital: null }], month, '', '');
    expect(html).toContain('nedostupné');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
