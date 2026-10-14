import './styles.css';
import { Chart, registerables, type Plugin } from 'chart.js';
import type { jsPDF as JsPdfDocument } from 'jspdf';
import {
  SHORTFALL_TOLERANCE,
  createDefaultMember,
  createDefaultState,
  simulate,
  solveRequiredMonthlyInvestment,
  solveSustainableMonthlyRent,
  validateAssumptions,
  validateMember,
  type CalculatorState,
  type GlobalAssumptions,
  type MemberInput,
  type MonthlyDraw,
  type SimulationResult,
  type ValidationIssue,
} from './model';
import { planCanvasSlices } from './pdf/pagination';

Chart.register(...registerables);

const now = new Date();
const AS_OF_MONTH = now.getFullYear() * 12 + now.getMonth();
const CURRENT_YEAR = now.getFullYear();
const STORAGE_KEY = 'rentier-calculator-v3';
const CONSENT_KEY = 'rentier-calculator-local-storage-consent';
const ROW_HEIGHT = 20;

const numberFormatter = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const money = (value: number): string => `${numberFormatter.format(Math.round(value || 0))} Kč`;
const largeMoney = (value: number): string => Math.abs(value || 0) >= 1_000_000
  ? `${((value || 0) / 1_000_000).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} mil. Kč`
  : money(value);
const axisMoney = (value: number | string): string | number => {
  const numeric = Number(value);
  if (Math.abs(numeric) >= 1_000_000) return `${(numeric / 1_000_000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} mil.`;
  if (Math.abs(numeric) >= 1_000) return `${Math.round(numeric / 1_000)} tis.`;
  return numeric;
};
const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
})[character] ?? character);
const cssVariable = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Chybí prvek #${id}.`);
  return found as T;
};

function parseStoredState(raw: string | null): CalculatorState | null {
  if (!raw) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<CalculatorState>;
    if (!candidate.assumptions || !Array.isArray(candidate.members) || candidate.members.length === 0) return null;
    const defaults = createDefaultState(CURRENT_YEAR);
    return {
      ...defaults,
      ...candidate,
      assumptions: { ...defaults.assumptions, ...candidate.assumptions },
      members: candidate.members.slice(0, 6).map((member) => ({
        ...createDefaultMember(CURRENT_YEAR),
        ...member,
      })),
    };
  } catch {
    return null;
  }
}

let storageConsent = localStorage.getItem(CONSENT_KEY) === 'yes';
let state = storageConsent
  ? parseStoredState(localStorage.getItem(STORAGE_KEY)) ?? createDefaultState(CURRENT_YEAR)
  : createDefaultState(CURRENT_YEAR);

function persistState(): void {
  if (!storageConsent) return;
  try {
    localStorage.setItem(CONSENT_KEY, 'yes');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    showMessage('Kalkulaci se nepodařilo uložit do tohoto prohlížeče.');
  }
}

function memberName(member: MemberInput, index: number): string {
  return member.name.trim() || `Osoba ${index + 1}`;
}

interface FieldDefinition<T> {
  key: keyof T;
  label: string;
  suffix?: string;
  wide?: boolean;
  integer?: boolean;
}

const GLOBAL_FIELDS: Array<FieldDefinition<GlobalAssumptions>> = [
  { key: 'investmentAccumulationRate', label: 'Investice – spoření', suffix: '%' },
  { key: 'dpsAccumulationRate', label: 'DPS – spoření', suffix: '%' },
  { key: 'investmentDrawdownRate', label: 'Investice – čerpání', suffix: '%' },
  { key: 'dpsDrawdownRate', label: 'DPS – čerpání', suffix: '%' },
];

const MEMBER_GROUPS: Array<{ title: string; fields: Array<FieldDefinition<MemberInput> & { text?: boolean }> }> = [
  { title: 'Základ', fields: [
    { key: 'name', label: 'Jméno', text: true },
    { key: 'birthYear', label: 'Ročník', integer: true },
    { key: 'targetMonthlyRent', label: 'Požadovaná renta', suffix: 'Kč/měs.', wide: true },
  ] },
  { title: 'Investice', fields: [
    { key: 'monthlyInvestment', label: 'Měsíčně', suffix: 'Kč' },
    { key: 'initialInvestment', label: 'Dnešní hodnota', suffix: 'Kč' },
    { key: 'oneTimeInvestment', label: 'Jednorázově', suffix: 'Kč' },
    { key: 'oneTimeInvestmentYear', label: 'Jednorázový vklad v roce', integer: true },
  ] },
  { title: 'Penzijní spoření (DPS)', fields: [
    { key: 'monthlyDps', label: 'Měsíčně', suffix: 'Kč' },
    { key: 'initialDps', label: 'Dnešní zůstatek', suffix: 'Kč' },
    { key: 'dpsDrawdownAge', label: 'Čerpat od věku', suffix: 'let', integer: true },
    { key: 'dpsDrawdownYears', label: 'Rozložit na', suffix: 'let', integer: true },
  ] },
  { title: 'Čerpání renty', fields: [
    { key: 'rentStartAge', label: 'Renta od věku', suffix: 'let', integer: true },
    { key: 'rentEndAge', label: 'Čerpat do věku', suffix: 'let', integer: true },
    { key: 'pensionAge', label: 'Státní důchod od', suffix: 'let', integer: true },
    { key: 'monthlyPension', label: 'Státní důchod', suffix: 'Kč/měs.' },
  ] },
];

function renderField<T>(definition: FieldDefinition<T> & { text?: boolean }, value: unknown, owner: string | number): string {
  const inputAttributes = definition.text
    ? 'type="text" placeholder="Jméno" autocomplete="off"'
    : `type="number" inputmode="decimal" step="${definition.integer ? '1' : 'any'}"`;
  return `<label class="f ${definition.wide ? 'wide' : ''}"><span>${escapeHtml(definition.label)}</span><span class="in"><input ${inputAttributes} data-owner="${owner}" data-key="${String(definition.key)}" value="${escapeHtml(value)}" />${definition.suffix ? `<em>${escapeHtml(definition.suffix)}</em>` : ''}</span></label>`;
}

function renderGlobalInputs(): void {
  element('globalInputs').innerHTML = GLOBAL_FIELDS
    .map((definition) => renderField(definition, state.assumptions[definition.key], 'global'))
    .join('');
  element<HTMLInputElement>('stateContribution').checked = state.assumptions.includeStateContribution;
}

function memberSummary(member: MemberInput): string {
  const excluded = member.active ? '' : 'vyřazeno z modelace · ';
  return `${excluded}${member.birthYear} · ${money(member.targetMonthlyRent)}/měs. od ${member.rentStartAge} let`;
}

function renderMembers(): void {
  element('members').innerHTML = state.members.map((member, index) => `
    <details class="member ${member.active ? '' : 'off'}" ${state.members.length === 1 ? 'open' : ''} data-member="${index}">
      <summary><strong data-name="${index}">${escapeHtml(memberName(member, index))}</strong><span data-summary="${index}">${escapeHtml(memberSummary(member))}</span></summary>
      <div class="mbody">
        <label class="include"><input type="checkbox" data-owner="${index}" data-key="active" ${member.active ? 'checked' : ''} /> Zahrnout do modelace</label>
        ${MEMBER_GROUPS.map(({ title, fields }) => `<div class="mgroup"><h3>${escapeHtml(title)}</h3><div class="grid2">${fields.map((definition) => renderField(definition, member[definition.key], index)).join('')}</div></div>`).join('')}
        <div class="warn" data-warning="${index}" hidden></div>
        ${state.members.length > 1 ? `<button class="btn ghost" type="button" data-remove="${index}">Odebrat osobu</button>` : ''}
      </div>
    </details>
  `).join('');
  element<HTMLButtonElement>('addMember').disabled = state.members.length >= 6;
}

function renderViewbar(): void {
  const active = state.members.map((member, index) => ({ member, index })).filter(({ member }) => member.active);
  if (state.selectedView !== 'all' && !active.some(({ index }) => index === state.selectedView)) state.selectedView = 'all';
  const choices: Array<['all' | number, string]> = active.length <= 1
    ? []
    : [['all', 'Celá domácnost'], ...active.map(({ member, index }) => [index, memberName(member, index)] as [number, string])];
  element('viewbar').innerHTML = choices.map(([value, label]) => `<button type="button" data-view="${value}" aria-pressed="${String(state.selectedView) === String(value)}">${escapeHtml(label)}</button>`).join('');
}

function updateIdentityInputs(): void {
  element<HTMLInputElement>('clientName').value = state.clientName;
  element<HTMLInputElement>('advisorName').value = state.advisorName;
  element<HTMLInputElement>('saveDraft').checked = storageConsent;
}

function showMessage(message: string): void {
  const target = element('exportMessage');
  target.hidden = !message;
  target.textContent = message;
}

let computeTimer: number | undefined;
function scheduleCompute(): void {
  window.clearTimeout(computeTimer);
  computeTimer = window.setTimeout(compute, 120);
}

element('globalInputs').addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  const key = input.dataset.key as keyof GlobalAssumptions | undefined;
  if (!key) return;
  (state.assumptions[key] as number) = input.value.trim() === '' ? Number.NaN : Number(input.value);
  scheduleCompute();
});

element('stateContribution').addEventListener('change', (event) => {
  state.assumptions.includeStateContribution = (event.target as HTMLInputElement).checked;
  scheduleCompute();
});

element('members').addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  const key = input.dataset.key as keyof MemberInput | undefined;
  const index = Number(input.dataset.owner);
  if (!key || !Number.isInteger(index) || !state.members[index]) return;
  const member = state.members[index];
  if (key === 'active') member.active = input.checked;
  else if (key === 'name') member.name = input.value;
  else (member[key] as number) = input.value.trim() === '' ? Number.NaN : Number(input.value);
  input.closest('.member')?.classList.toggle('off', !member.active);
  const name = document.querySelector<HTMLElement>(`[data-name="${index}"]`);
  const summary = document.querySelector<HTMLElement>(`[data-summary="${index}"]`);
  if (name) name.textContent = memberName(member, index);
  if (summary) summary.textContent = memberSummary(member);
  if (key === 'name' || key === 'active') renderViewbar();
  scheduleCompute();
});

element('members').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove]');
  if (!button) return;
  state.members.splice(Number(button.dataset.remove), 1);
  state.selectedView = 'all';
  renderMembers();
  renderViewbar();
  compute();
});

element('addMember').addEventListener('click', () => {
  if (state.members.length >= 6) return;
  const reference = state.members[0];
  state.members.push(createDefaultMember(CURRENT_YEAR, {
    birthYear: reference?.birthYear ?? 1990,
    rentStartAge: reference?.rentStartAge ?? 60,
    rentEndAge: reference?.rentEndAge ?? 85,
    targetMonthlyRent: 20_000,
    monthlyInvestment: 2_000,
    monthlyPension: 15_000,
  }));
  renderMembers();
  renderViewbar();
  compute();
  const details = document.querySelectorAll<HTMLDetailsElement>('.member');
  const last = details.item(details.length - 1);
  if (last) last.open = true;
});

element('viewbar').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
  if (!button) return;
  state.selectedView = button.dataset.view === 'all' ? 'all' : Number(button.dataset.view);
  renderViewbar();
  compute();
});

element('clientName').addEventListener('input', (event) => {
  state.clientName = (event.target as HTMLInputElement).value;
  persistState();
});
element('advisorName').addEventListener('input', (event) => {
  state.advisorName = (event.target as HTMLInputElement).value;
  persistState();
});
element('saveDraft').addEventListener('change', (event) => {
  storageConsent = (event.target as HTMLInputElement).checked;
  if (storageConsent) persistState();
  else {
    localStorage.removeItem(CONSENT_KEY);
    localStorage.removeItem(STORAGE_KEY);
    showMessage('Lokálně uložená kalkulace byla odstraněna.');
  }
});
element('newCalculation').addEventListener('click', () => {
  if (!window.confirm('Smazat zadané údaje a začít novou kalkulaci?')) return;
  const advisorName = state.advisorName;
  state = createDefaultState(CURRENT_YEAR);
  state.advisorName = advisorName;
  updateIdentityInputs();
  renderGlobalInputs();
  renderMembers();
  renderViewbar();
  compute();
});

type PhaseType = 'accumulation' | 'investment' | 'investment+dps' | 'investment+pension' | 'investment+dps+pension';
interface Phase { start: number; end: number; type: PhaseType; average?: MonthlyDraw }

const PHASE_STRIP: Record<PhaseType, string> = {
  accumulation: 'spoření', investment: 'investice', 'investment+dps': 'inv. + DPS',
  'investment+pension': 'inv. + důchod', 'investment+dps+pension': 'inv. + DPS + důchod',
};
const PHASE_TITLE: Record<PhaseType, string> = {
  accumulation: 'Akumulace', investment: 'Start renty', 'investment+dps': 'Zapojení penzijka',
  'investment+pension': 'Státní důchod', 'investment+dps+pension': 'Penzijko a důchod',
};

function phaseColor(type: PhaseType): string {
  if (type === 'accumulation') return '--c-acc';
  if (type.includes('dps')) return '--c-dps';
  if (type.includes('pension')) return '--c-pen';
  return '--c-inv';
}

function createPhases(result: SimulationResult): Phase[] {
  const points = [AS_OF_MONTH, result.rentStartMonth, result.dpsDrawdownStartMonth, result.dpsDrawdownEndMonth, result.pensionStartMonth, result.endMonth]
    .filter((month) => month >= AS_OF_MONTH && month <= result.endMonth);
  const uniquePoints = [...new Set(points)].sort((a, b) => a - b);
  const phases: Phase[] = [];
  for (let index = 0; index < uniquePoints.length - 1; index += 1) {
    const start = uniquePoints[index];
    const end = uniquePoints[index + 1];
    if (start === undefined || end === undefined || end <= start) continue;
    let type: PhaseType;
    if (start < result.rentStartMonth) type = 'accumulation';
    else {
      const dps = start >= result.dpsDrawdownStartMonth && start < result.dpsDrawdownEndMonth;
      const pension = start >= result.pensionStartMonth;
      type = `investment${dps ? '+dps' : ''}${pension ? '+pension' : ''}` as PhaseType;
    }
    const previous = phases.at(-1);
    if (previous?.type === type) previous.end = end;
    else phases.push({ start, end, type });
  }
  for (const phase of phases) {
    if (phase.type === 'accumulation') continue;
    const total: MonthlyDraw = { investment: 0, dps: 0, pension: 0, shortfall: 0 };
    let count = 0;
    for (let month = phase.start; month < phase.end; month += 1) {
      const draw = result.draws.get(month);
      if (!draw) continue;
      count += 1;
      total.investment += draw.investment; total.dps += draw.dps; total.pension += draw.pension; total.shortfall += draw.shortfall;
    }
    phase.average = count === 0 ? total : {
      investment: total.investment / count, dps: total.dps / count,
      pension: total.pension / count, shortfall: total.shortfall / count,
    };
  }
  return phases;
}

interface ComputedMember {
  member: MemberInput;
  index: number;
  result: SimulationResult;
  requiredInvestment: number;
  sustainableRent: number;
  requiredCapital: number;
  phases: Phase[];
}

let currentViewMembers: MemberInput[] = [];
let lastResults: ComputedMember[] = [];

const phasePlugin: Plugin = {
  id: 'phaseStrips',
  beforeDatasetsDraw(chart) {
    const shade = (chart as typeof chart & { $shade?: Phase[] }).$shade;
    if (!shade?.length) return;
    const x = chart.scales.x;
    if (!x) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    for (const phase of shade) {
      if (phase.type === 'accumulation') continue;
      const x1 = Math.max(chartArea.left, x.getPixelForValue(phase.start / 12));
      const x2 = Math.min(chartArea.right, x.getPixelForValue(phase.end / 12));
      if (x2 <= x1) continue;
      ctx.fillStyle = `${cssVariable(phaseColor(phase.type))}14`;
      ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
      ctx.strokeStyle = cssVariable('--line'); ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x1, chartArea.top); ctx.lineTo(x1, chartArea.bottom); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  },
  afterDraw(chart) {
    const rows = (chart as typeof chart & { $strips?: Array<{ name: string; phases: Phase[] }> }).$strips;
    if (!rows?.length) return;
    const x = chart.scales.x;
    if (!x) return;
    const { ctx, chartArea } = chart;
    const top = chartArea.top - rows.length * ROW_HEIGHT - 6;
    ctx.save(); ctx.font = '600 11px Montserrat, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    rows.forEach((row, rowIndex) => row.phases.forEach((phase, phaseIndex) => {
      const x1 = Math.max(chartArea.left, x.getPixelForValue(phase.start / 12));
      const x2 = Math.min(chartArea.right, x.getPixelForValue(phase.end / 12));
      const width = x2 - x1 - 2;
      if (width <= 1) return;
      const y = top + rowIndex * ROW_HEIGHT;
      ctx.fillStyle = cssVariable(phaseColor(phase.type));
      ctx.beginPath(); ctx.roundRect(x1 + 1, y, width, ROW_HEIGHT - 4, 4); ctx.fill();
      const fullLabel = phaseIndex === 0 ? `${row.name}: ${PHASE_STRIP[phase.type]}` : PHASE_STRIP[phase.type];
      ctx.fillStyle = phase.type === 'accumulation' ? cssVariable('--c-acc-ink') : '#fff';
      let label = fullLabel;
      while (label.length > 2 && ctx.measureText(label).width > width - 10) label = label.slice(0, -2);
      if (label !== fullLabel) label = label.length > 3 ? `${label.slice(0, -1)}…` : '';
      if (label) ctx.fillText(label, x1 + 6, y + (ROW_HEIGHT - 4) / 2 + .5);
    }));
    ctx.restore();
  },
};
Chart.register(phasePlugin);
Chart.defaults.font.family = 'Montserrat, "Segoe UI", system-ui, sans-serif';
Chart.defaults.font.size = 12;

function ageTitle(yearValue: number): string {
  const year = Math.floor(yearValue + 1e-6);
  return `Rok ${year} · ${currentViewMembers.map((member, index) => `${memberName(member, index)} ${year - member.birthYear} let`).join(', ')}`;
}

function baseChartOptions(yTitle: string): any {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    interaction: { mode: 'nearest', axis: 'x', intersect: false }, layout: { padding: { top: 30, right: 8 } },
    plugins: { legend: { display: false }, tooltip: { callbacks: {
      title: (items: Array<{ parsed: { x: number } }>) => items.length ? ageTitle(items[0]?.parsed.x ?? 0) : '',
      label: (item: { dataset: { label?: string }; parsed: { y: number } }) => `${item.dataset.label}: ${money(item.parsed.y)}`,
    }, filter: (item: { parsed: { y: number } }) => item.parsed.y > .5 } },
    scales: {
      x: { type: 'linear', ticks: { callback: (value: number) => Number.isInteger(value) ? String(value) : '', maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { callback: axisMoney }, title: { display: true, text: yTitle } },
    },
  };
}

type ChartPoint = { x: number; y: number };

const capitalChart = new Chart<'line', ChartPoint[]>(element<HTMLCanvasElement>('capitalChart'), {
  type: 'line', data: { datasets: [
    { label: 'Investice', data: [], fill: 'origin', pointRadius: 0, borderWidth: 2, tension: .15 },
    { label: 'Penzijko (DPS)', data: [], fill: '-1', pointRadius: 0, borderWidth: 2, tension: .15 },
  ] }, options: baseChartOptions('Kč'),
});
const rentOptions = baseChartOptions('Kč / měs.');
rentOptions.scales.x.stacked = true;
rentOptions.plugins.tooltip.callbacks.title = (items: Array<{ parsed: { x: number } }>) => items.length ? ageTitle((items[0]?.parsed.x ?? .5) - .5) : '';
const rentChart = new Chart<'bar', ChartPoint[]>(element<HTMLCanvasElement>('rentChart'), {
  type: 'bar', data: { datasets: [
    { label: 'Investice', data: [] }, { label: 'Penzijko (DPS)', data: [] },
    { label: 'Státní důchod', data: [] }, { label: 'Chybí', data: [] },
  ] }, options: rentOptions,
});
rentChart.data.datasets.forEach((dataset) => { dataset.barPercentage = 1; dataset.categoryPercentage = .86; });

function clearCharts(): void {
  for (const chart of [capitalChart, rentChart]) {
    chart.data.datasets.forEach((dataset) => { dataset.data = []; });
    (chart as typeof chart & { $strips?: unknown[] }).$strips = [];
    (chart as typeof chart & { $shade?: Phase[] | null }).$shade = null;
    chart.update();
  }
}

function markValidationIssues(memberIssues: Map<number, ValidationIssue[]>, globalIssues: ValidationIssue[]): void {
  document.querySelectorAll<HTMLInputElement>('[data-key]').forEach((input) => input.removeAttribute('aria-invalid'));
  for (const issue of globalIssues) {
    document.querySelector<HTMLInputElement>(`[data-owner="global"][data-key="${issue.field}"]`)?.setAttribute('aria-invalid', 'true');
  }
  state.members.forEach((_, index) => {
    const warning = document.querySelector<HTMLElement>(`[data-warning="${index}"]`);
    const issues = memberIssues.get(index) ?? [];
    if (warning) {
      warning.hidden = issues.length === 0;
      warning.innerHTML = issues.length ? `<strong>Zkontrolujte zadání:</strong><ul>${issues.map((issue) => `<li>${escapeHtml(issue.message)}</li>`).join('')}</ul>` : '';
    }
    for (const issue of issues) {
      document.querySelector<HTMLInputElement>(`[data-owner="${index}"][data-key="${issue.field}"]`)?.setAttribute('aria-invalid', 'true');
    }
  });
}

function valueAt(samples: SimulationResult['samples'], monthValue: number): SimulationResult['samples'][number] {
  let value = samples[0] ?? { month: monthValue, investment: 0, dps: 0 };
  for (const sample of samples) {
    if (sample.month <= monthValue) value = sample;
    else break;
  }
  return value;
}

function compute(): void {
  persistState();
  const active = state.members.map((member, index) => ({ member, index })).filter(({ member }) => member.active);
  const globalIssues = validateAssumptions(state.assumptions);
  const memberIssues = new Map<number, ValidationIssue[]>();
  for (const { member, index } of active) memberIssues.set(index, validateMember(member, AS_OF_MONTH));
  markValidationIssues(memberIssues, globalIssues);
  const hasIssues = globalIssues.length > 0 || [...memberIssues.values()].some((issues) => issues.length > 0);

  if (active.length === 0 || hasIssues) {
    const message = active.length === 0
      ? 'Zahrňte do modelace alespoň jednu osobu.'
      : 'Výsledky nejsou vypočteny, dokud neopravíte označená zadání.';
    element('summary').innerHTML = `<div class="empty ${hasIssues ? 'status bad' : ''}">${message}</div>`;
    element('journeys').innerHTML = '';
    element('kpis').innerHTML = '';
    element<HTMLButtonElement>('exportPdf').disabled = true;
    lastResults = [];
    clearCharts();
    return;
  }

  element<HTMLButtonElement>('exportPdf').disabled = false;
  const results = active.map(({ member, index }): ComputedMember => {
    const result = simulate(member, state.assumptions, AS_OF_MONTH);
    const requiredInvestment = solveRequiredMonthlyInvestment(member, state.assumptions, AS_OF_MONTH);
    const sustainableRent = solveSustainableMonthlyRent(member, state.assumptions, AS_OF_MONTH);
    const requiredSimulation = Number.isFinite(requiredInvestment)
      ? simulate(member, state.assumptions, AS_OF_MONTH, { monthlyInvestment: requiredInvestment })
      : null;
    return {
      member: { ...member, name: memberName(member, index) }, index, result, requiredInvestment, sustainableRent,
      requiredCapital: requiredSimulation
        ? requiredSimulation.capitalAtRentStart.investment + requiredSimulation.capitalAtRentStart.dps
        : Number.NaN,
      phases: createPhases(result),
    };
  });
  lastResults = results;
  const view = state.selectedView === 'all' ? results : results.filter(({ index }) => index === state.selectedView);
  currentViewMembers = view.map(({ member }) => member);
  renderCharts(view);
  renderSummary(results);
  renderJourneys(view);
  renderKpis(results);
}

function renderCharts(view: ComputedMember[]): void {
  const minimum = AS_OF_MONTH / 12;
  const maximum = Math.max(...view.map(({ result }) => result.endMonth)) / 12;
  const months = [...new Set(view.flatMap(({ result }) => result.samples.map((sample) => sample.month)))].sort((a, b) => a - b);
  const investmentSeries: Array<{ x: number; y: number }> = [];
  const dpsSeries: Array<{ x: number; y: number }> = [];
  for (const month of months) {
    let investment = 0; let dps = 0;
    for (const { result } of view) {
      const value = valueAt(result.samples, month);
      investment += value.investment; dps += value.dps;
    }
    investmentSeries.push({ x: month / 12, y: Math.max(0, investment) });
    dpsSeries.push({ x: month / 12, y: Math.max(0, dps) });
  }

  const monthly = new Map<number, MonthlyDraw>();
  for (const { result } of view) result.draws.forEach((draw, month) => {
    const total = monthly.get(month) ?? { investment: 0, dps: 0, pension: 0, shortfall: 0 };
    total.investment += draw.investment; total.dps += draw.dps; total.pension += draw.pension; total.shortfall += draw.shortfall;
    monthly.set(month, total);
  });
  const annual = new Map<number, MonthlyDraw & { count: number }>();
  monthly.forEach((draw, month) => {
    const year = Math.floor(month / 12);
    const total = annual.get(year) ?? { investment: 0, dps: 0, pension: 0, shortfall: 0, count: 0 };
    total.investment += draw.investment; total.dps += draw.dps; total.pension += draw.pension; total.shortfall += draw.shortfall; total.count += 1;
    annual.set(year, total);
  });
  const years = [...annual.keys()].sort((a, b) => a - b);
  const rentSeries = (['investment', 'dps', 'pension', 'shortfall'] as const).map((key) => years.map((year) => {
    const value = annual.get(year);
    return { x: year + .5, y: value ? value[key] / value.count : 0 };
  }));
  const strips = view.map(({ member, phases }) => ({ name: member.name, phases }));
  const shade = view.length === 1 ? view[0]?.phases ?? null : null;
  const colors = [cssVariable('--c-inv'), cssVariable('--c-dps'), cssVariable('--c-pen'), cssVariable('--c-short')];
  for (const chart of [capitalChart, rentChart]) {
    (chart as typeof chart & { $strips?: typeof strips }).$strips = strips;
    (chart as typeof chart & { $shade?: Phase[] | null }).$shade = shade;
    chart.options.layout = { padding: { top: strips.length * ROW_HEIGHT + 10, right: 8 } };
    if (chart.options.scales?.x) { chart.options.scales.x.min = minimum; chart.options.scales.x.max = maximum; }
  }
  capitalChart.data.datasets[0]!.data = investmentSeries;
  capitalChart.data.datasets[1]!.data = dpsSeries;
  capitalChart.data.datasets[0]!.borderColor = colors[0]; capitalChart.data.datasets[0]!.backgroundColor = `${colors[0]}99`;
  capitalChart.data.datasets[1]!.borderColor = colors[1]; capitalChart.data.datasets[1]!.backgroundColor = `${colors[1]}99`;
  capitalChart.update();
  rentSeries.forEach((series, index) => { rentChart.data.datasets[index]!.data = series; rentChart.data.datasets[index]!.backgroundColor = colors[index]; });
  rentChart.update();
}

function commonStartCapital(results: ComputedMember[]): number | null {
  const starts = new Set(results.map(({ result }) => result.rentStartMonth));
  if (starts.size !== 1) return null;
  return results.reduce((sum, { result }) => sum + result.capitalAtRentStart.investment + result.capitalAtRentStart.dps, 0);
}

function renderSummary(results: ComputedMember[]): void {
  const target = results.reduce((sum, { member }) => sum + member.targetMonthlyRent, 0);
  const saving = results.reduce((sum, { member }) => sum + member.monthlyInvestment + member.monthlyDps, 0);
  const oneTime = results.reduce((sum, { member }) => sum + member.oneTimeInvestment, 0);
  const allSolvable = results.every(({ requiredInvestment }) => Number.isFinite(requiredInvestment));
  const required = results.reduce((sum, { member, requiredInvestment }) => sum + (Number.isFinite(requiredInvestment) ? requiredInvestment : 0) + member.monthlyDps, 0);
  const sustainable = results.reduce((sum, { sustainableRent }) => sum + sustainableRent, 0);
  const capital = commonStartCapital(results);
  const short = results.filter(({ result }) => result.totalShortfall > SHORTFALL_TOLERANCE);
  const status = short.length === 0
    ? `<div class="status ok">Plán vychází: při současném spoření pokryjete rentu ${money(target)}/měs. po celou zvolenou dobu čerpání.</div>`
    : `<div class="status bad">Při současném spoření renta nevystačí – kapitál dojde: ${short.map(({ member, result }) => `${escapeHtml(member.name)} od ${Math.floor(((result.depletedAt ?? result.endMonth) - result.birthMonth) / 12)} let`).join(', ')}.</div>`;
  element('summary').innerHTML = `
    <div><div class="k">Cílová renta domácnosti</div><div class="v">${money(target)}</div><div class="s">měsíčně</div></div>
    <div><div class="k">Odkládáte celkem</div><div class="v">${money(saving)}</div><div class="s">měsíčně${oneTime ? ` + ${largeMoney(oneTime)} jednorázově` : ''}</div></div>
    <div><div class="k">Potřebná úložka pro cíl</div><div class="v">${allSolvable ? money(required) : '—'}</div><div class="s">investice + DPS měsíčně</div></div>
    <div><div class="k">Udržitelná renta</div><div class="v">${money(sustainable)}</div><div class="s">při současném spoření</div></div>
    <div><div class="k">Kapitál na startu renty</div><div class="v">${capital === null ? '—' : largeMoney(capital)}</div><div class="s">${capital === null ? 'nelze sčítat: osoby začínají v různých letech' : 'součet ve společném měsíci startu'}</div></div>
    ${status}`;
}

function phasePeriod(phase: Phase, result: SimulationResult): string {
  const startAge = Math.floor((phase.start - result.birthMonth) / 12);
  const endAge = Math.round((phase.end - result.birthMonth) / 12);
  const years = Math.round((phase.end - phase.start) / 12 * 10) / 10;
  return `${startAge}–${endAge} let · ${Math.floor(phase.start / 12)}–${Math.floor(phase.end / 12)} · ${String(years).replace('.', ',')} let`;
}

function renderJourneys(view: ComputedMember[]): void {
  element('journeys').innerHTML = view.map(({ member, result, phases }) => {
    const cards = phases.map((phase) => {
      let rows = '';
      if (phase.type === 'accumulation') {
        const capital = result.capitalAtRentStart.investment + result.capitalAtRentStart.dps;
        rows = `<li><span><i class="dot legend-inv"></i>Investice</span><b>${money(member.monthlyInvestment)}/měs.</b></li>
          ${member.initialInvestment ? `<li><span><i class="dot legend-inv"></i>Dnešní hodnota</span><b>${money(member.initialInvestment)}</b></li>` : ''}
          ${member.oneTimeInvestment ? `<li><span><i class="dot legend-inv"></i>Jednorázově ${member.oneTimeInvestmentYear}</span><b>${money(member.oneTimeInvestment)}</b></li>` : ''}
          <li><span><i class="dot legend-dps"></i>DPS${result.monthlyStateContribution ? ` + stát až ${money(result.monthlyStateContribution)}` : ''}</span><b>${money(member.monthlyDps)}/měs.</b></li>
          <li><span>Na startu renty</span><b>${largeMoney(capital)}</b></li>`;
      } else {
        const average = phase.average ?? { investment: 0, dps: 0, pension: 0, shortfall: 0 };
        rows = (average.investment > .5 ? `<li><span><i class="dot legend-inv"></i>Investice</span><b>${money(average.investment)}</b></li>` : '')
          + (average.dps > .5 ? `<li><span><i class="dot legend-dps"></i>Penzijko</span><b>${money(average.dps)}</b></li>` : '')
          + (average.pension > .5 ? `<li><span><i class="dot legend-pen"></i>Státní důchod</span><b>${money(average.pension)}</b></li>` : '')
          + (average.shortfall > .5 ? `<li class="short"><span><i class="dot legend-short"></i>Chybí</span><b>${money(average.shortfall)}</b></li>` : '');
      }
      return `<div class="seg" style="border-top-color:var(${phaseColor(phase.type)});flex-grow:${Math.max(1, (phase.end - phase.start) / 12)}"><h4>${PHASE_TITLE[phase.type]}</h4><div class="when">${phasePeriod(phase, result)}</div><ul>${rows}</ul></div>`;
    }).join('');
    return `<div class="journey"><div class="jn">${escapeHtml(member.name)}<span>ročník ${member.birthYear}, renta ${money(member.targetMonthlyRent)}/měs. od ${member.rentStartAge} do ${member.rentEndAge} let</span></div><div class="track">${cards}</div></div>`;
  }).join('');
}

function renderKpis(results: ComputedMember[]): void {
  element('kpis').innerHTML = results.map(({ member, result, requiredInvestment, sustainableRent, requiredCapital }) => {
    const capital = result.capitalAtRentStart.investment + result.capitalAtRentStart.dps;
    const covered = result.totalShortfall <= SHORTFALL_TOLERANCE;
    const requiredText = Number.isNaN(requiredInvestment) ? '—' : !Number.isFinite(requiredInvestment) ? 'nedosažitelné' : requiredInvestment === 0 ? '0 Kč (pokryto)' : `${money(requiredInvestment)}/měs.`;
    const lasts = covered
      ? `do ${member.rentEndAge} let, zůstane ${largeMoney(result.endingInvestment + result.endingDps)}`
      : `do ${Math.floor(((result.depletedAt ?? result.endMonth) - result.birthMonth) / 12)} let`;
    const verdict = covered
      ? requiredInvestment === 0 ? 'Dnešní kapitál a DPS stačí samy; pravidelná investice není nutná.' : `Rezerva oproti potřebné úložce: ${money(member.monthlyInvestment - requiredInvestment)}/měs.`
      : Number.isFinite(requiredInvestment) ? `Pro cíl navyšte investice o ${money(Math.max(0, requiredInvestment - member.monthlyInvestment))}/měs., nebo počítejte s rentou ${money(sustainableRent)}/měs.` : 'Cíl nelze při zadaném období dosáhnout.';
    return `<article class="kcard"><h3>${escapeHtml(member.name)} <span style="font-weight:500;color:var(--muted);font-size:13px">${CURRENT_YEAR - member.birthYear} let</span></h3><dl>
      <dt>Spoření do startu renty</dt><dd>${Math.max(0, Math.round((result.rentStartMonth - AS_OF_MONTH) / 12 * 10) / 10).toLocaleString('cs-CZ')} let</dd>
      <dt>Kapitál na startu renty</dt><dd>${largeMoney(capital)}</dd><dt>z toho DPS</dt><dd>${largeMoney(result.capitalAtRentStart.dps)}</dd>
      <dt>Potřebný kapitál pro cíl</dt><dd>${Number.isFinite(requiredCapital) ? largeMoney(Math.max(requiredCapital, 0)) : '—'}</dd>
      <dt>Potřebná úložka do investic</dt><dd class="${covered ? 'ok' : 'bad'}">${requiredText}</dd>
      <dt>Vaše úložka do investic</dt><dd>${money(member.monthlyInvestment)}/měs.</dd><dt>Udržitelná renta</dt><dd>${money(sustainableRent)}/měs.</dd>
      <dt>Peníze vystačí</dt><dd class="${covered ? 'ok' : 'bad'}">${lasts}</dd>
      <dt>Vlastní vklady celkem</dt><dd>${largeMoney(result.contributedInvestment + result.contributedDps)}</dd>
      <dt>Státní příspěvky DPS</dt><dd>${largeMoney(result.receivedStateContribution)}</dd>
    </dl><div class="verdict" style="color:var(${covered ? '--ok' : '--bad'})">${verdict}</div></article>`;
  }).join('');
}

const PDF_COLORS = { investment: '#6fae2a', dps: '#2f6db5', pension: '#d9962b', shortfall: '#c64036' };
const slug = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function reportHtml(results: ComputedMember[], capitalImage: string, rentImage: string): string {
  const target = results.reduce((sum, { member }) => sum + member.targetMonthlyRent, 0);
  const saving = results.reduce((sum, { member }) => sum + member.monthlyInvestment + member.monthlyDps, 0);
  const sustainable = results.reduce((sum, { sustainableRent }) => sum + sustainableRent, 0);
  const capital = commonStartCapital(results);
  const statusOk = results.every(({ result }) => result.totalShortfall <= SHORTFALL_TOLERANCE);
  const legend = `<div class="rleg"><span><i style="background:${PDF_COLORS.investment}"></i>Investice</span><span><i style="background:${PDF_COLORS.dps}"></i>DPS</span><span><i style="background:${PDF_COLORS.pension}"></i>Státní důchod</span><span><i style="background:${PDF_COLORS.shortfall}"></i>Chybí</span></div>`;
  return `<div class="blk"><div class="rhead"><div><h1>Rentiérská kalkulace</h1><div>Spoření, čerpání renty a státní důchod</div></div><div class="meta"><b>${escapeHtml(state.clientName || 'Klient')}</b>${state.advisorName ? `Zpracoval: ${escapeHtml(state.advisorName)}<br />` : ''}Datum: ${new Date().toLocaleDateString('cs-CZ')}</div></div>
    <div class="rp"><div class="rsum"><div><div class="k">Cílová renta</div><div class="v">${money(target)}/měs.</div></div><div><div class="k">Odkládáte</div><div class="v">${money(saving)}/měs.</div></div><div><div class="k">Udržitelná renta</div><div class="v">${money(sustainable)}/měs.</div></div><div><div class="k">Kapitál na startu</div><div class="v">${capital === null ? 'Různá data startu' : largeMoney(capital)}</div></div><div><div class="k">Výnosy investic</div><div class="v" style="font-size:13px">${state.assumptions.investmentAccumulationRate} % / ${state.assumptions.investmentDrawdownRate} %</div></div><div><div class="k">Výnosy DPS</div><div class="v" style="font-size:13px">${state.assumptions.dpsAccumulationRate} % / ${state.assumptions.dpsDrawdownRate} %</div></div><div class="rstatus" style="color:${statusOk ? '#3e8a1e' : '#b8362d'}">${statusOk ? 'Plán vychází po celou zvolenou dobu.' : 'U nejméně jedné osoby vzniká nedostatek kapitálu.'}</div></div></div></div>
    <div class="blk rp"><h2>Zadání</h2><table><tr><th>Osoba</th><th>Ročník</th><th>Renta</th><th>Investice</th><th>DPS</th><th>Čerpání</th><th>Důchod</th></tr>${results.map(({ member }) => `<tr><td><b>${escapeHtml(member.name)}</b></td><td>${member.birthYear}</td><td class="n">${money(member.targetMonthlyRent)}</td><td class="n">${money(member.monthlyInvestment)}/měs.<br />dnes ${money(member.initialInvestment)}</td><td class="n">${money(member.monthlyDps)}/měs.<br />dnes ${money(member.initialDps)}</td><td>${member.rentStartAge}–${member.rentEndAge} let<br />DPS ${member.dpsDrawdownAge}–${member.dpsDrawdownAge + member.dpsDrawdownYears} let</td><td class="n">${money(member.monthlyPension)}<br />od ${member.pensionAge} let</td></tr>`).join('')}</table></div>
    <div class="blk rp"><h2>Cesta kapitálu</h2><img src="${capitalImage}" alt="" /></div>
    <div class="blk rp"><h2>Z čeho se renta platí</h2>${legend}<img src="${rentImage}" alt="" /></div>
    <div class="blk rp"><h2>Výsledky po osobách</h2><table><tr><th>Ukazatel</th>${results.map(({ member }) => `<th>${escapeHtml(member.name)}</th>`).join('')}</tr>
      ${[
        ['Kapitál na startu renty', (item: ComputedMember) => largeMoney(item.result.capitalAtRentStart.investment + item.result.capitalAtRentStart.dps)],
        ['Potřebná úložka do investic', (item: ComputedMember) => Number.isFinite(item.requiredInvestment) ? `${money(item.requiredInvestment)}/měs.` : '—'],
        ['Udržitelná renta', (item: ComputedMember) => `${money(item.sustainableRent)}/měs.`],
        ['Zůstatek na konci', (item: ComputedMember) => largeMoney(item.result.endingInvestment + item.result.endingDps)],
      ].map(([label, format]) => `<tr><td>${label as string}</td>${results.map((item) => `<td class="n">${(format as (item: ComputedMember) => string)(item)}</td>`).join('')}</tr>`).join('')}</table>
      <p class="rnote">Orientační model. Výnos je nominální p.a. dělený 12; vklady a výběry probíhají na začátku měsíce. Bez inflace, poplatků a daní. Nárok na DPS a státní příspěvek je nutné ověřit individuálně.</p></div>`;
}

async function addCanvasBlock(pdf: JsPdfDocument, canvas: HTMLCanvasElement, currentY: number): Promise<number> {
  const pageWidth = 595.28; const pageHeight = 841.89; const margin = 22; const pointsPerCssPixel = pageWidth / 794; const scale = 2;
  const slices = planCanvasSlices(canvas.height, scale, pointsPerCssPixel, pageHeight, margin, margin + 12, currentY);
  let relativePage = 0; let finalY = currentY;
  for (const slice of slices) {
    while (relativePage < slice.pageIndex) { pdf.addPage(); relativePage += 1; }
    const fragment = document.createElement('canvas');
    fragment.width = canvas.width; fragment.height = slice.sourceHeight;
    fragment.getContext('2d')?.drawImage(canvas, 0, slice.sourceY, canvas.width, slice.sourceHeight, 0, 0, canvas.width, slice.sourceHeight);
    pdf.addImage(fragment.toDataURL('image/jpeg', .92), 'JPEG', 0, slice.destinationY, pageWidth, slice.destinationHeight);
    finalY = slice.destinationY + slice.destinationHeight + 4;
  }
  return finalY;
}

async function exportPdf(): Promise<void> {
  const button = element<HTMLButtonElement>('exportPdf');
  const previousTheme = document.documentElement.getAttribute('data-theme');
  const previousView = state.selectedView;
  button.disabled = true; showMessage('Připravuji PDF…');
  try {
    await document.fonts?.ready;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    document.documentElement.setAttribute('data-theme', 'light'); state.selectedView = 'all'; compute();
    if (!lastResults.length) { showMessage('Nejprve opravte zadání.'); return; }
    [capitalChart, rentChart].forEach((chart) => { chart.options.animation = false; chart.options.devicePixelRatio = 2; });
    capitalChart.resize(714, 340); rentChart.resize(714, 290); await nextFrame();
    const report = element('report');
    report.innerHTML = reportHtml(lastResults, capitalChart.toBase64Image('image/png', 1), rentChart.toBase64Image('image/png', 1));
    await Promise.all([...report.querySelectorAll('img')].map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); })));
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 0;
    for (const block of report.querySelectorAll<HTMLElement>('.blk')) {
      const canvas = await html2canvas(block, { scale: 2, backgroundColor: '#fff', logging: false, useCORS: false });
      y = await addCanvasBlock(pdf, canvas, y);
    }
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) { pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(120); pdf.text(`${page} / ${pageCount}`, 555, 827); }
    pdf.save(`Rentierska-kalkulace${state.clientName ? `-${slug(state.clientName)}` : ''}.pdf`);
    report.innerHTML = ''; showMessage('PDF staženo.');
  } catch (error) {
    console.error(error); showMessage('Export PDF selhal. Zkuste to prosím znovu.');
  } finally {
    if (previousTheme === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', previousTheme);
    state.selectedView = previousView;
    [capitalChart, rentChart].forEach((chart) => { chart.options.animation = { duration: 250 }; chart.options.devicePixelRatio = undefined; chart.resize(); });
    renderViewbar(); compute(); button.disabled = false;
    window.setTimeout(() => showMessage(''), 5_000);
  }
}

element('exportPdf').addEventListener('click', () => { void exportPdf(); });
updateIdentityInputs(); renderGlobalInputs(); renderMembers(); renderViewbar(); compute();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', compute);
