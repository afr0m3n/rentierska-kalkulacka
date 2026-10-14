import { commonStartCapital, formatMonth, recommendedIncrease, SHORTFALL_TOLERANCE } from '../model';
import type { CalculatorState, MemberInput, SimulationResult } from '../model';

export interface ReportResult {
  member: MemberInput;
  result: SimulationResult;
  requiredInvestment: number | null;
  sustainableRent: number;
  requiredCapital: number | null;
}

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!);
const number = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 });
const money = (value: number | null): string => value === null || !Number.isFinite(value) ? 'nedostupné' : `${number.format(value)} Kč`;
const table = (title: string, rows: Array<[string, string]>) => `<div class="blk rp"><h2>${escape(title)}</h2><table><tr><th style="width:50%">Ukazatel</th><th>Hodnota</th></tr>${rows.map(([label, value]) => `<tr><td>${escape(label)}</td><td>${escape(value)}</td></tr>`).join('')}</table></div>`;

export function reportHtml(state: CalculatorState, results: ReportResult[], asOfMonth: number, capitalImage: string, rentImage: string): string {
  const target = results.reduce((sum, { member }) => sum + member.targetMonthlyRent, 0);
  const capital = commonStartCapital(results.map(({ result }) => result));
  const blocks = [
    `<div class="blk"><div class="rhead"><h1>Rentiérská kalkulace</h1><div class="meta"><b>${escape(state.clientName || 'Klient')}</b>${state.advisorName ? `Zpracoval: ${escape(state.advisorName)}<br />` : ''}Referenční měsíc: ${formatMonth(asOfMonth)}</div></div></div>`,
    table('Souhrn domácnosti – samostatná osobní portfolia', [
      ['Součet cílových příjmů osob (včetně DPS a důchodu)', money(target) + '/měs.'],
      ['Součet potřebných úložek (každá zaokrouhlená nahoru)', results.some((item) => item.requiredInvestment === null) ? 'nedostupné' : money(results.reduce((sum, item) => sum + item.requiredInvestment! + item.member.monthlyDps, 0)) + '/měs.'],
      ['Součet osobních udržitelných rent (zaokrouhleno dolů)', money(results.reduce((sum, item) => sum + item.sustainableRent, 0)) + '/měs.'],
      ['Kapitál na společném startu renty', capital === null ? 'Nesčítá se: různá data startu.' : money(capital)],
      ['Pokrytí celého období', results.every(({ result }) => result.totalShortfall <= SHORTFALL_TOLERANCE) ? 'Cíl je pokrytý.' : 'Vzniká schodek do cíle.'],
    ]),
    table('Společné předpoklady', [
      ['Výnos investic: spoření / čerpání', `${state.assumptions.investmentAccumulationRate} % / ${state.assumptions.investmentDrawdownRate} % p.a.`],
      ['Výnos DPS: spoření / čerpání', `${state.assumptions.dpsAccumulationRate} % / ${state.assumptions.dpsDrawdownRate} % p.a.`],
      ['Státní příspěvek DPS', state.assumptions.includeStateContribution ? 'Zahrnut při předpokladu splnění nároku; končí od zadaného přiznání důchodu.' : 'Nezahrnut.'],
      ['Úročení a časování', 'Nominální p.a. / 12, vklad a výběr na začátku měsíce.'],
      ['Cílová renta', 'Celkový požadovaný příjem, včetně DPS a státního důchodu.'],
      ['Přebytek', 'Odchází mimo model, automaticky se nereinvestuje.'],
      ['Omezení', 'Bez inflace, valorizace, poplatků a daní. Nárok na DPS se ověřuje individuálně.'],
    ]),
  ];
  for (const { member, result, requiredInvestment, sustainableRent, requiredCapital } of results) {
    blocks.push(table(`Zadání – ${member.name}`, [
      ['Narození (měsíc/rok)', `${member.birthMonth}/${member.birthYear}`],
      ['Cílový celkový příjem', money(member.targetMonthlyRent) + '/měs.'],
      ['Investice – měsíční vklad', money(member.monthlyInvestment)],
      ['Investice – počáteční hodnota', money(member.initialInvestment)],
      ['Investice – jednorázový vklad', money(member.oneTimeInvestment)],
      ['Rok jednorázového vkladu', String(member.oneTimeInvestmentYear)],
      ['Měsíc jednorázového vkladu', member.oneTimeInvestment === 0 ? 'Není plánován.' : formatMonth(member.oneTimeInvestmentYear === Math.floor(asOfMonth / 12) ? asOfMonth : member.oneTimeInvestmentYear * 12)],
      ['DPS – měsíční vklad', money(member.monthlyDps)],
      ['DPS – počáteční zůstatek', money(member.initialDps)],
      ['DPS – počátek a doba výplaty', `${formatMonth(result.dpsDrawdownStartMonth)}; ${member.dpsDrawdownYears} let`],
      ['Renta – počátek / konec (konec není zahrnut)', `${formatMonth(result.rentStartMonth)} / ${formatMonth(result.endMonth)}`],
      ['Státní důchod – začátek', `${member.pensionStartMonth}/${member.pensionStartYear}`],
      ['Státní důchod – plná měsíční částka', money(member.monthlyPension)],
    ]));
    blocks.push(table(`Výsledky – ${member.name}`, [
      ['Kapitál na startu: investice / DPS', `${money(result.capitalAtRentStart.investment)} / ${money(result.capitalAtRentStart.dps)}`],
      ['Potřebný kapitál pro cíl', money(requiredCapital)],
      ['Potřebná úložka do investic – nahoru', money(requiredInvestment)],
      ['Doporučené navýšení spoření – nahoru', money(recommendedIncrease(member.monthlyInvestment, requiredInvestment))],
      ['Udržitelná renta – dolů', money(sustainableRent)],
      ['Zůstatek na konci: investice / DPS', `${money(result.endingInvestment)} / ${money(result.endingDps)}`],
      ['Vlastní vklady v modelovaném období', money(result.contributedInvestment + result.contributedDps)],
      ['Státní příspěvky v modelovaném období', money(result.receivedStateContribution)],
      ['Důchod před rentou – celkem mimo cíl, nereinvestován', money([...result.draws].filter(([month]) => month < result.rentStartMonth).reduce((sum, [, draw]) => sum + draw.pension, 0))],
    ]));
    const draws = [...result.draws].filter(([month]) => month >= result.rentStartMonth).map(([, draw]) => draw);
    const average = (key: keyof typeof draws[number]) => draws.reduce((sum, draw) => sum + draw[key], 0) / draws.length;
    blocks.push(table(`Příjmy – ${member.name} (měsíční průměr za období renty)`, [
      ['Skutečně vyplacené DPS', money(average('dps'))],
      ['Z DPS použito na cíl', money(average('dpsUsed'))],
      ['Skutečně vyplacený státní důchod', money(average('pension'))],
      ['Z důchodu použito na cíl', money(average('pensionUsed'))],
      ['Výběr investic', money(average('investment'))],
      ['Skutečný celkový příjem', money(average('actualIncome'))],
      ['Pokrytí cíle', money(average('covered'))],
      ['Přebytek nad cílem (nereinvestován)', money(average('surplus'))],
      ['Schodek do cíle', money(average('shortfall'))],
    ]));
  }
  blocks.push(`<div class="blk rp"><h2>Cesta kapitálu</h2><p>Po konci modelace osoby její kapitál opouští graf; konečný zůstatek je v tabulce výše.</p><img src="${capitalImage}" alt="" /></div>`);
  blocks.push(`<div class="blk rp"><h2>Skutečně vyplacené příjmy a schodek</h2><p>Průměry za všech 12 měsíců roku. Investice, DPS, státní důchod a schodek do cíle.</p><img src="${rentImage}" alt="" /></div>`);
  return blocks.join('');
}
