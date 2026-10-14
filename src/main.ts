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
  currentPragueMonth,
  formatMonth,
  emptyDraw,
  capitalAt,
  annualDraws,
  commonStartCapital as sharedStartCapital,
  recommendedIncrease,
  type CalculatorState,
  type GlobalAssumptions,
  type MemberInput,
  type MonthlyDraw,
  type SimulationResult,
  type ValidationIssue,
} from './model';
import { planCanvasSlices } from './pdf/pagination';
import { reportHtml } from './pdf/report';
import { parseStoredState, STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY, CONSENT_KEY } from './state/storage';

Chart.register(...registerables);

const now = new Date();
const AS_OF_MONTH = currentPragueMonth(now);
const CURRENT_YEAR = Math.floor(AS_OF_MONTH / 12);
const ROW_HEIGHT = 20;

const numberFormatter = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const money = (value: number | null): string => value === null || !Number.isFinite(value) ? '—' : `${numberFormatter.format(Math.round(value))} Kč`;
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

const readStorage = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
let storageConsent = readStorage(CONSENT_KEY) === 'yes';
let state: CalculatorState = parseStoredState(readStorage(STORAGE_KEY) ?? readStorage(PREVIOUS_STORAGE_KEY) ?? readStorage(LEGACY_STORAGE_KEY), CURRENT_YEAR) ?? createDefaultState(CURRENT_YEAR);
let exportInProgress = false;

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
    { key: 'birthYear', label: 'Rok narození', integer: true },
    { key: 'birthMonth', label: 'Měsíc narození (1–12)', integer: true },
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
    { key: 'pensionStartYear', label: 'Důchod od roku', integer: true },
    { key: 'pensionStartMonth', label: 'Důchod od měsíce (1–12)', integer: true },
    { key: 'monthlyPension', label: 'Státní důchod', suffix: 'Kč/měs.' },
  ] },
];

function renderField<T>(definition: FieldDefinition<T> & { text?: boolean }, value: unknown, owner: string | number): string {
  const inputAttributes = definition.text
    ? 'type="text" placeholder="Jméno" autocomplete="off"'
    : `type="number" inputmode="decimal" step="${definition.integer ? '1' : 'any'}"`;
  return `<label class="f ${definition.wide ? 'wide' : ''}"><span>${escapeHtml(definition.label)}</span><span class="in"><input ${inputAttributes} data-owner="${owner}" data-key="${String(definition.key)}" value="${value === null || (typeof value === 'number' && !Number.isFinite(value)) ? '' : escapeHtml(value)}" />${definition.suffix ? `<em>${escapeHtml(definition.suffix)}</em>` : ''}</span></label>`;
}

function renderGlobalInputs(): void {
  element('globalInputs').innerHTML = GLOBAL_FIELDS
    .map((definition) => renderField(definition, state.assumptions[definition.key], 'global'))
    .join('');
  element<HTMLInputElement>('stateContribution').checked = state.assumptions.includeStateContribution;
}

function memberSummary(member: MemberInput): string {
  const excluded = member.active ? '' : 'vyřazeno z modelace · ';
  return `${excluded}${member.birthMonth ?? '?'}/${member.birthYear} · ${money(member.targetMonthlyRent)}/měs. od ${member.rentStartAge} let`;
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
  lastResults = [];
  element<HTMLButtonElement>('exportPdf').disabled = true;
  element('summary').innerHTML = '<div class="empty">Přepočítávám zadání…</div>';
  element('journeys').innerHTML = ''; element('kpis').innerHTML = ''; clearCharts();
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
    birthMonth: reference?.birthMonth ?? null,
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
    try { for (const key of [CONSENT_KEY, STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY]) localStorage.removeItem(key); }
    catch { showMessage('Prohlížeč nedovoluje odstranit lokální data.'); return; }
    showMessage('Lokálně uložená kalkulace byla odstraněna.');
  }
});
element('newCalculation').addEventListener('click', () => {
  if (!window.confirm('Smazat zadané údaje a začít novou kalkulaci?')) return;
  try { for (const key of [STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY]) localStorage.removeItem(key); }
  catch { showMessage('Prohlížeč nedovoluje odstranit dříve uložené kalkulace.'); }
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
  accumulation: 'spoření', investment: 'renta', 'investment+dps': 'renta + DPS',
  'investment+pension': 'renta + důchod', 'investment+dps+pension': 'DPS + důchod',
};
const PHASE_TITLE: Record<PhaseType, string> = {
  accumulation: 'Akumulace', investment: 'Čerpání renty', 'investment+dps': 'Zapojení penzijka',
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
      const dps = [...result.draws].some(([month, draw]) => month >= start && month < end && draw.dps > 0);
      const pension = [...result.draws].some(([month, draw]) => month >= start && month < end && draw.pension > 0);
      type = `investment${dps ? '+dps' : ''}${pension ? '+pension' : ''}` as PhaseType;
    }
    const previous = phases.at(-1);
    if (previous?.type === type) previous.end = end;
    else phases.push({ start, end, type });
  }
  for (const phase of phases) {
    const total = emptyDraw();
    let count = 0;
    for (let month = phase.start; month < phase.end; month += 1) {
      const draw = result.draws.get(month);
      if (!draw) continue;
      count += 1;
      for (const key of Object.keys(total) as Array<keyof MonthlyDraw>) total[key] += draw[key];
    }
    phase.average = total;
    if (count > 0) for (const key of Object.keys(total) as Array<keyof MonthlyDraw>) total[key] /= count;
  }
  return phases;
}

interface ComputedMember {
  member: MemberInput;
  index: number;
  result: SimulationResult;
  requiredInvestment: number | null;
  sustainableRent: number;
  requiredCapital: number | null;
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
  const month = Math.round(yearValue * 12);
  return `${formatMonth(month)} · ${currentViewMembers.map((member, index) => `${memberName(member, index)} ${Math.floor((month - (member.birthYear * 12 + (member.birthMonth ?? 1) - 1)) / 12)} let`).join(', ')}`;
}

function baseChartOptions(yTitle: string): any {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false }, layout: { padding: { top: 30, right: 8 } },
    plugins: { colors: { enabled: false }, legend: { display: false }, tooltip: { callbacks: {
      title: (items: Array<{ parsed: { x: number } }>) => items.length ? ageTitle(items[0]?.parsed.x ?? 0) : '',
      label: (item: { dataset: { label?: string }; parsed: { y: number } }) => `${item.dataset.label}: ${money(item.parsed.y)}`,
    }, filter: (item: { parsed: { y: number } }) => item.parsed.y > .5 } },
    scales: {
      x: { type: 'linear', ticks: { callback: (value: number) => Number.isInteger(value) ? String(value) : '', maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { callback: axisMoney }, title: { display: true, text: yTitle } },
    },
  };
}

type ChartPoint = { x: number; y: number | null };

const capitalChart = new Chart<'line', ChartPoint[]>(element<HTMLCanvasElement>('capitalChart'), {
  type: 'line', data: { datasets: [
    { label: 'Investice', data: [], borderColor: cssVariable('--c-inv'), backgroundColor: `${cssVariable('--c-inv')}99`, fill: 'origin', pointRadius: 0, borderWidth: 2, tension: .15 },
    { label: 'Penzijko (DPS)', data: [], borderColor: cssVariable('--c-dps'), backgroundColor: `${cssVariable('--c-dps')}99`, fill: '-1', pointRadius: 0, borderWidth: 2, tension: .15 },
  ] }, options: baseChartOptions('Kč'),
});
const rentOptions = baseChartOptions('Kč / měs.');
rentOptions.scales.x.stacked = true;
rentOptions.plugins.tooltip.callbacks.title = (items: Array<{ parsed: { x: number } }>) => items.length ? ageTitle((items[0]?.parsed.x ?? .5) - .5) : '';
const rentChart = new Chart<'bar', ChartPoint[]>(element<HTMLCanvasElement>('rentChart'), {
  type: 'bar', data: { datasets: [
    { label: 'Investice', data: [], backgroundColor: cssVariable('--c-inv') }, { label: 'Penzijko (DPS)', data: [], backgroundColor: cssVariable('--c-dps') },
    { label: 'Státní důchod', data: [], backgroundColor: cssVariable('--c-pen') }, { label: 'Chybí', data: [], backgroundColor: cssVariable('--c-short') },
  ] }, options: rentOptions,
});
rentChart.data.datasets.forEach((dataset) => { dataset.barPercentage = 1; dataset.categoryPercentage = .86; });

function clearCharts(): void {
  for (const chart of [capitalChart, rentChart]) {
    chart.data.datasets.forEach((dataset) => { dataset.data = []; });
    (chart as typeof chart & { $strips?: unknown[] }).$strips = [];
    (chart as typeof chart & { $shade?: Phase[] | null }).$shade = null;
    chart.stop(); chart.update('none');
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

function compute(): void {
  if (exportInProgress) return;
  try { computeResults(); }
  catch (error) {
    lastResults = []; clearCharts();
    element('journeys').innerHTML = ''; element('kpis').innerHTML = '';
    element('summary').innerHTML = `<div class="empty status bad">Výpočet není dostupný: ${escapeHtml(error instanceof Error ? error.message : 'Neplatné zadání.')}</div>`;
    element<HTMLButtonElement>('exportPdf').disabled = true;
  }
}

function computeResults(): void {
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
    const requiredSimulation = requiredInvestment !== null
      ? simulate(member, state.assumptions, AS_OF_MONTH, { monthlyInvestment: requiredInvestment })
      : null;
    return {
      member: { ...member, name: memberName(member, index) }, index, result, requiredInvestment, sustainableRent,
      requiredCapital: requiredSimulation
        ? requiredSimulation.capitalAtRentStart.investment + requiredSimulation.capitalAtRentStart.dps
        : null,
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
  const investmentSeries: ChartPoint[] = [];
  const dpsSeries: ChartPoint[] = [];
  for (const month of months) {
    let investment = 0; let dps = 0;
    for (const { result } of view) {
      const value = capitalAt(result, month);
      if (value) { investment += value.investment; dps += value.dps; }
    }
    const hasActive = view.some(({ result }) => capitalAt(result, month) !== null);
    investmentSeries.push({ x: month / 12, y: hasActive ? Math.max(0, investment) : null });
    dpsSeries.push({ x: month / 12, y: hasActive ? Math.max(0, dps) : null });
  }

  const annual = annualDraws(view.map(({ result }) => result));
  const years = [...annual.keys()].sort((a, b) => a - b);
  const rentSeries = (['investment', 'dps', 'pension', 'shortfall'] as const).map((key) => years.map((year) => ({
    x: year + .5, y: annual.get(year)?.[key] ?? 0,
  })));
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
  capitalChart.stop(); capitalChart.update('none');
  rentSeries.forEach((series, index) => { rentChart.data.datasets[index]!.data = series; rentChart.data.datasets[index]!.backgroundColor = colors[index]; });
  rentChart.stop(); rentChart.update('none');
}

function commonStartCapital(results: ComputedMember[]): number | null {
  return sharedStartCapital(results.map(({ result }) => result));
}

function renderSummary(results: ComputedMember[]): void {
  const target = results.reduce((sum, { member }) => sum + member.targetMonthlyRent, 0);
  const saving = results.reduce((sum, { member }) => sum + member.monthlyInvestment + member.monthlyDps, 0);
  const oneTime = results.reduce((sum, { member }) => sum + member.oneTimeInvestment, 0);
  const allSolvable = results.every(({ requiredInvestment }) => requiredInvestment !== null);
  const required = results.reduce((sum, { member, requiredInvestment }) => sum + (requiredInvestment !== null ? requiredInvestment : 0) + member.monthlyDps, 0);
  const sustainable = results.reduce((sum, { sustainableRent }) => sum + sustainableRent, 0);
  const capital = commonStartCapital(results);
  const short = results.filter(({ result }) => result.totalShortfall > SHORTFALL_TOLERANCE);
  const status = short.length === 0
    ? `<div class="status ok">Plán vychází: při současném spoření pokryjete rentu ${money(target)}/měs. po celou zvolenou dobu čerpání.</div>`
    : `<div class="status bad">Při současném spoření renta nevystačí – kapitál dojde: ${short.map(({ member, result }) => `${escapeHtml(member.name)} od ${Math.floor(((result.depletedAt ?? result.endMonth) - result.birthMonth) / 12)} let`).join(', ')}.</div>`;
  element('summary').innerHTML = `
    <div><div class="k">Součet osobních cílových rent</div><div class="v">${money(target)}</div><div class="s">každá ve vlastním období čerpání</div></div>
    <div><div class="k">Odkládáte celkem</div><div class="v">${money(saving)}</div><div class="s">měsíčně${oneTime ? ` + ${largeMoney(oneTime)} jednorázově` : ''}</div></div>
    <div><div class="k">Potřebná úložka pro cíl</div><div class="v">${allSolvable ? money(required) : '—'}</div><div class="s">investice + DPS měsíčně</div></div>
    <div><div class="k">Součet osobních udržitelných rent</div><div class="v">${money(sustainable)}</div><div class="s">bez sdílení portfolií</div></div>
    <div><div class="k">Kapitál na startu renty</div><div class="v">${capital === null ? '—' : largeMoney(capital)}</div><div class="s">${capital === null ? 'nelze sčítat: osoby začínají v různých termínech' : 'součet ve společném měsíci startu'}</div></div>
    ${status}`;
}

function phasePeriod(phase: Phase, result: SimulationResult): string {
  const startAge = Math.floor((phase.start - result.birthMonth) / 12);
  const endAge = Math.round((phase.end - result.birthMonth) / 12);
  const years = Math.round((phase.end - phase.start) / 12 * 10) / 10;
  return `${startAge}–${endAge} let · ${formatMonth(phase.start)}–${formatMonth(phase.end)} · ${String(years).replace('.', ',')} let`;
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
          ${phase.average && phase.average.pension > 0 ? `<li><span>Důchod před rentou (průměr)</span><b>${money(phase.average.pension)}/měs.</b></li><li><span>Příjem mimo cíl (nereinvestován)</span><b>${money(phase.average.surplus)}/měs.</b></li>` : ''}
          <li><span>Na startu renty</span><b>${largeMoney(capital)}</b></li>`;
      } else {
        const average = phase.average ?? emptyDraw();
        rows = (average.investment > .5 ? `<li><span><i class="dot legend-inv"></i>Investice</span><b>${money(average.investment)}</b></li>` : '')
          + (average.dps > .5 ? `<li><span><i class="dot legend-dps"></i>Vyplacené DPS</span><b>${money(average.dps)}</b></li><li><span>z DPS na cíl</span><b>${money(average.dpsUsed)}</b></li>` : '')
          + (average.pension > .5 ? `<li><span><i class="dot legend-pen"></i>Vyplacený důchod</span><b>${money(average.pension)}</b></li><li><span>z důchodu na cíl</span><b>${money(average.pensionUsed)}</b></li>` : '')
          + `<li><span>Skutečný příjem</span><b>${money(average.actualIncome)}</b></li>`
          + (average.surplus > .5 ? `<li><span>Přebytek nad cílem</span><b>${money(average.surplus)}</b></li>` : '')
          + `<li><span>Pokrytí cíle</span><b>${money(average.covered)}</b></li>`
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
    const requiredText = requiredInvestment === null ? 'nedosažitelné v rozsahu modelu' : requiredInvestment === 0 ? '0 Kč (pokryto)' : `${money(requiredInvestment)}/měs.`;
    const lasts = covered
      ? `do ${member.rentEndAge} let, zůstane ${largeMoney(result.endingInvestment + result.endingDps)}`
      : `do ${Math.floor(((result.depletedAt ?? result.endMonth) - result.birthMonth) / 12)} let`;
    const verdict = covered
      ? requiredInvestment === 0 ? 'Dnešní kapitál a DPS stačí samy; pravidelná investice není nutná.' : `Rezerva oproti potřebné úložce: ${money(member.monthlyInvestment - (requiredInvestment ?? 0))}/měs.`
      : requiredInvestment !== null ? `Pro cíl navyšte investice o ${money(recommendedIncrease(member.monthlyInvestment, requiredInvestment))}/měs., nebo počítejte s rentou ${money(sustainableRent)}/měs.` : 'Cíl nelze při zadaném období dosáhnout.';
    return `<article class="kcard"><h3>${escapeHtml(member.name)} <span style="font-weight:500;color:var(--muted);font-size:13px">${Math.floor((AS_OF_MONTH - result.birthMonth) / 12)} let</span></h3><dl>
      <dt>Spoření do startu renty</dt><dd>${Math.max(0, Math.round((result.rentStartMonth - AS_OF_MONTH) / 12 * 10) / 10).toLocaleString('cs-CZ')} let</dd>
      <dt>Kapitál na startu renty</dt><dd>${largeMoney(capital)}</dd><dt>z toho DPS</dt><dd>${largeMoney(result.capitalAtRentStart.dps)}</dd>
      <dt>Potřebný kapitál pro cíl</dt><dd>${requiredCapital !== null ? largeMoney(Math.max(requiredCapital, 0)) : '—'}</dd>
      <dt>Potřebná úložka do investic</dt><dd class="${covered ? 'ok' : 'bad'}">${requiredText}</dd>
      <dt>Vaše úložka do investic</dt><dd>${money(member.monthlyInvestment)}/měs.</dd><dt>Udržitelná renta</dt><dd>${money(sustainableRent)}/měs.</dd>
      <dt>Peníze vystačí</dt><dd class="${covered ? 'ok' : 'bad'}">${lasts}</dd>
      <dt>Vlastní vklady celkem</dt><dd>${largeMoney(result.contributedInvestment + result.contributedDps)}</dd>
      <dt>Státní příspěvky DPS</dt><dd>${largeMoney(result.receivedStateContribution)}</dd>
    </dl><div class="verdict" style="color:var(${covered ? '--ok' : '--bad'})">${verdict}</div></article>`;
  }).join('');
}

const slug = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function addCanvasBlock(pdf: JsPdfDocument, canvas: HTMLCanvasElement, currentY: number): Promise<number> {
  const pageWidth = 595.28; const pageHeight = 841.89; const margin = 22; const pointsPerCssPixel = pageWidth / 794; const scale = 2;
  const blockHeight = canvas.height / scale * pointsPerCssPixel;
  const usableHeight = pageHeight - margin * 2 - 12;
  if (blockHeight <= usableHeight && currentY + blockHeight > pageHeight - margin - 12) { pdf.addPage(); currentY = margin; }
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
  if (exportInProgress) return;
  window.clearTimeout(computeTimer);
  compute();
  if (!lastResults.length) { showMessage('Nejprve opravte zadání.'); return; }
  exportInProgress = true;
  const controls = [...document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')].map((control) => ({ control, disabled: control.disabled }));
  controls.forEach(({ control }) => { control.disabled = true; });
  const previousTheme = document.documentElement.getAttribute('data-theme');
  const previousView = state.selectedView;
  const report = element('report');
  showMessage('Připravuji PDF…');
  try {
    await document.fonts?.ready;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    document.documentElement.setAttribute('data-theme', 'light');
    state.selectedView = 'all';
    currentViewMembers = lastResults.map(({ member }) => member);
    [capitalChart, rentChart].forEach((chart) => { chart.stop(); chart.options.animation = false; chart.options.responsive = false; chart.options.devicePixelRatio = 2; });
    renderCharts(lastResults);
    capitalChart.resize(714, 340); rentChart.resize(714, 290);
    [capitalChart, rentChart].forEach((chart) => { chart.stop(); chart.update('none'); });
    await nextFrame();
    report.innerHTML = reportHtml(state, lastResults, AS_OF_MONTH, capitalChart.toBase64Image('image/png', 1), rentChart.toBase64Image('image/png', 1));
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
    showMessage('PDF staženo.');
  } catch (error) {
    console.error(error); showMessage('Export PDF selhal. Zkuste to prosím znovu.');
  } finally {
    report.innerHTML = '';
    if (previousTheme === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', previousTheme);
    state.selectedView = previousView;
    [capitalChart, rentChart].forEach((chart) => { chart.options.animation = false; chart.options.responsive = true; chart.options.devicePixelRatio = undefined; chart.resize(); });
    controls.forEach(({ control, disabled }) => { control.disabled = disabled; });
    exportInProgress = false;
    renderViewbar(); compute();
    window.setTimeout(() => showMessage(''), 5_000);
  }
}

element('exportPdf').addEventListener('click', () => { void exportPdf(); });
updateIdentityInputs(); renderGlobalInputs(); renderMembers(); renderViewbar(); compute();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', compute);
