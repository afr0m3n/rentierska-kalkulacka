import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { resolve } from 'node:path';

// Count source colors inside the plot, excluding the colored phase strips.
async function rentBarPixels(page: Page) {
  return page.locator('#rentChart').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!;
    const top = Math.floor(canvas.height * .35);
    const data = context.getImageData(0, top, canvas.width, canvas.height - top).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 200 &&
      ((data[i]! === 111 && data[i + 1]! === 174 && data[i + 2]! === 42) ||
       (data[i]! === 217 && data[i + 1]! === 150 && data[i + 2]! === 43))) count++;
    return count;
  });
}

async function field(page: Page, key: string, value: string, owner = '0') {
  await page.locator(`[data-owner="${owner}"][data-key="${key}"]`).fill(value);
}

async function completeDates(page: Page) {
  await field(page, 'birthMonth', '10');
  await field(page, 'pensionStartMonth', '12');
  await expect(page.locator('#kpis .kcard')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-14T10:00:00Z'));
  await page.goto('/');
});

test('validates dates and unsafe inputs; runs without external requests', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4173') && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.reload();
  await expect(page.locator('#summary')).toContainText('neopravíte');
  await expect(page.locator('#exportPdf')).toBeDisabled();
  await completeDates(page);
  await expect(page.locator('#summary .v')).toHaveCount(5);
  await field(page, 'monthlyInvestment', '1000001');
  await expect(page.locator('#summary')).toContainText('neopravíte');
  await expect(page.locator('#kpis .kcard')).toHaveCount(0);
  await expect(page.locator('[data-key="monthlyInvestment"]')).toHaveAttribute('aria-invalid', 'true');
  await field(page, 'monthlyInvestment', '3000');
  await expect(page.locator('#exportPdf')).toBeEnabled();
  await field(page, 'rentEndAge', '50');
  await expect(page.locator('#summary')).toContainText('neopravíte');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('loads old calculations without inventing missing dates and supports opt-in storage', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('rentier-calculator-v3', JSON.stringify({ assumptions: { investmentAccumulationRate: 0, investmentDrawdownRate: 0, dpsAccumulationRate: 0, dpsDrawdownRate: 0, includeStateContribution: false }, members: [{ birthYear: 1990, monthlyInvestment: 4321 }] })));
  await page.reload();
  await expect(page.locator('[data-key="monthlyInvestment"]')).toHaveValue('4321');
  await expect(page.locator('[data-key="birthMonth"]')).toHaveValue('');
  await expect(page.locator('#summary')).toContainText('neopravíte');
  await completeDates(page);
  expect(await page.evaluate(() => localStorage.getItem('rentier-calculator-v4'))).toBeNull();
  await page.locator('#saveDraft').check();
  await page.reload();
  await expect(page.locator('[data-key="birthMonth"]')).toHaveValue('10');
  await page.locator('#saveDraft').uncheck();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('rentier')))).toEqual([]);
});

test('shows actual DPS, target coverage and unreinvested surplus; hides zero-income phase labels', async ({ page }) => {
  await completeDates(page);
  for (const key of ['investmentAccumulationRate', 'investmentDrawdownRate', 'dpsAccumulationRate', 'dpsDrawdownRate']) await field(page, key, '0', 'global');
  await field(page, 'birthYear', '1966');
  await field(page, 'rentStartAge', '60');
  await field(page, 'rentEndAge', '61');
  await field(page, 'targetMonthlyRent', '1000');
  await field(page, 'monthlyInvestment', '0');
  await field(page, 'monthlyDps', '0');
  await field(page, 'initialDps', '120000');
  await field(page, 'dpsDrawdownYears', '1');
  await field(page, 'monthlyPension', '0');
  await expect(page.locator('#journeys')).toContainText('10 000');
  await expect(page.locator('#journeys')).toContainText('9 000');
  await expect(page.locator('#journeys')).toContainText('Pokrytí cíle');
  await expect(page.locator('#journeys h4')).not.toContainText(['Státní důchod']);
  await field(page, 'initialDps', '0');
  await expect(page.locator('#journeys')).not.toContainText('Zapojení penzijka');
});

test('household views respect different starts and fit the viewport', async ({ page }, testInfo) => {
  await completeDates(page);
  await page.locator('#addMember').click();
  await field(page, 'birthMonth', '11', '1');
  await field(page, 'pensionStartMonth', '12', '1');
  await expect(page.locator('#summary')).toContainText('nelze sčítat');
  await page.getByRole('button', { name: 'Osoba 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Osoba 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#journeys .journey')).toHaveCount(1);
  await expect.poll(() => rentBarPixels(page)).toBeGreaterThan(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('calculator.png'), fullPage: true });
  await page.locator('#summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('results-viewport.png') });
});

test('review: a positive implausibly early pension blocks results and PDF', async ({ page }) => {
  await completeDates(page);
  await field(page, 'pensionStartYear', '1990');
  await field(page, 'pensionStartMonth', '10');
  await expect(page.locator('[data-warning="0"]')).toContainText('limit kalkulačky');
  await expect(page.locator('#kpis .kcard')).toHaveCount(0);
  await expect(page.locator('#exportPdf')).toBeDisabled();
  await field(page, 'pensionStartYear', '2016');
  await expect(page.locator('[data-warning="0"]')).toContainText('nejdříve od 50 let');
  await field(page, 'pensionStartYear', '2040');
  await field(page, 'pensionStartMonth', '9');
  await expect(page.locator('#exportPdf')).toBeDisabled();
  await field(page, 'pensionStartMonth', '10');
  await expect(page.locator('#kpis .kcard')).toHaveCount(1);
});

test('review: suggested pension years follow birth edits, explicit and stored years remain fixed', async ({ page }) => {
  await completeDates(page);
  await field(page, 'birthYear', '2000');
  await expect(page.locator('[data-key="pensionStartYear"]')).toHaveValue('2065');
  await expect(page.locator('[data-pension-hint="0"]')).toContainText('Navržený');
  await field(page, 'birthYear', '1970');
  await expect(page.locator('[data-key="pensionStartYear"]')).toHaveValue('2035');
  await field(page, 'pensionStartYear', '2040');
  await field(page, 'birthYear', '1980');
  await expect(page.locator('[data-key="pensionStartYear"]')).toHaveValue('2040');
  await expect(page.locator('[data-pension-hint="0"]')).toContainText('neposune');
  await page.locator('#saveDraft').check();
  await page.reload();
  await field(page, 'birthYear', '1975');
  await expect(page.locator('[data-key="pensionStartYear"]')).toHaveValue('2040');
  await expect(page.locator('#kpis .kcard')).toHaveCount(1);
});

test('review: first and last partial-year income bars fit entirely inside the plot', async ({ page }) => {
  // Record real canvas geometry, rather than a production-only testing hook.
  await page.addInitScript(() => {
    const recorder = window as unknown as { rentRects: Array<{ x: number; y: number; width: number; height: number }> };
    recorder.rentRects = [];
    const rect = CanvasRenderingContext2D.prototype.rect;
    CanvasRenderingContext2D.prototype.rect = function (x, y, width, height) {
      if (this.canvas.id === 'rentChart') recorder.rentRects.push({ x, y, width, height });
      return rect.call(this, x, y, width, height);
    };
  });
  await page.reload();
  await completeDates(page);
  await field(page, 'birthYear', '1966');
  await field(page, 'rentEndAge', '61');
  await field(page, 'monthlyDps', '0');
  await field(page, 'monthlyInvestment', '0');
  await field(page, 'targetMonthlyRent', '1000');
  await field(page, 'monthlyPension', '2000');
  await field(page, 'pensionStartYear', '2026');
  await page.evaluate(() => { (window as unknown as { rentRects: unknown[] }).rentRects = []; });
  await field(page, 'pensionStartMonth', '10');
  await expect(page.locator('#kpis .kcard')).toHaveCount(1);
  const geometry = await page.locator('#rentChart').evaluate((canvas: HTMLCanvasElement) => {
    const rects = (window as unknown as { rentRects: Array<{ x: number; y: number; width: number; height: number }> }).rentRects;
    const plot = rects.filter((rect) => rect.width > canvas.clientWidth * .5 && rect.x > 0 && rect.y > 0 && rect.height > 50).at(-1)!;
    const bars = rects.filter((rect) => rect.x > 0 && rect.y > 0 && rect.width > 0 && rect.width < canvas.clientWidth * .5 && rect.height > 1);
    return { plot, bars };
  });
  expect(geometry.plot).toBeDefined();
  expect(geometry.bars).toHaveLength(2);
  for (const bar of geometry.bars) {
    expect(bar.x).toBeGreaterThanOrEqual(geometry.plot.x - .5);
    expect(bar.x + bar.width).toBeLessThanOrEqual(geometry.plot.x + geometry.plot.width + .5);
  }
  const [first, last] = geometry.bars;
  expect(first!.x + first!.width / 2).toBeLessThan(geometry.plot.x + geometry.plot.width / 2);
  expect(last!.x + last!.width / 2).toBeGreaterThan(geometry.plot.x + geometry.plot.width / 2);
  expect(last!.height / first!.height).toBeCloseTo(3, 1);
});

test('review: closed members identify their errors and global rate errors explain the cause', async ({ page }) => {
  await completeDates(page);
  await page.locator('#addMember').click();
  await page.locator('[data-member="1"] > summary').click();
  await expect(page.locator('[data-member="1"]')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-error-marker="1"]')).toBeVisible();
  await expect(page.locator('[data-error-marker="1"]')).toContainText('Chybné zadání');
  await expect(page.locator('#summary')).toContainText('Osoba 2');
  await expect(page.locator('#exportPdf')).toBeDisabled();
  await page.locator('[data-member="1"] > summary').click();
  await expect(page.locator('[data-warning="1"]')).toContainText('měsíc začátku důchodu');
  await field(page, 'pensionStartMonth', '12', '1');
  await expect(page.locator('[data-error-marker="1"]')).toBeHidden();
  await expect(page.locator('#exportPdf')).toBeEnabled();
  await field(page, 'investmentAccumulationRate', '31', 'global');
  await expect(page.locator('#globalWarnings')).toBeVisible();
  await expect(page.locator('#globalWarnings')).toContainText('Investice – spoření');
  await expect(page.locator('#globalWarnings')).toContainText('nejvýše 30 %');
  await expect(page.locator('#summary')).toContainText('výnosy produktů');
  await field(page, 'investmentAccumulationRate', '10', 'global');
  await expect(page.locator('#globalWarnings')).toBeHidden();
  await expect(page.locator('#exportPdf')).toBeEnabled();
});

test('exports a complete real PDF, blocks concurrent exports and restores the view', async ({ page }, testInfo) => {
  await completeDates(page);
  await field(page, 'initialInvestment', '123456');
  await field(page, 'oneTimeInvestment', '654321');
  await field(page, 'oneTimeInvestmentYear', '2030');
  await expect(page.locator('#exportPdf')).toBeEnabled();
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  const reportSnapshot = page.locator('#report');
  const reportReady = expect(reportSnapshot).toContainText('jednorázový', { timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportPdf').click();
  await expect(page.locator('#exportPdf')).toBeDisabled();
  await page.locator('#exportPdf').evaluate((button: HTMLButtonElement) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await reportReady;
  await expect(reportSnapshot).toContainText('654');
  await expect(reportSnapshot).toContainText('2030');
  await expect(reportSnapshot).toContainText('Státní příspěvek');
  await expect(reportSnapshot).toContainText('Počáteční', { ignoreCase: true });
  const reportBarPixels = await reportSnapshot.locator('img').nth(1).evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const top = Math.floor(canvas.height * .35);
    const data = context.getImageData(0, top, canvas.width, canvas.height - top).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 200 && data[i]! === 217 && data[i + 1]! === 150 && data[i + 2]! === 43) count++;
    return count;
  });
  expect(reportBarPixels).toBeGreaterThan(1000);
  const download = await downloadPromise;
  const pdfPath = testInfo.outputPath('calculation.pdf');
  await download.saveAs(pdfPath);
  await expect(page.locator('#exportPdf')).toBeEnabled();
  expect(downloads).toHaveLength(1);
  const bytes = await readFile(pdfPath);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const loadingTask = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/', useSystemFonts: false });
  const pdf = await loadingTask.promise;
  expect(pdf.numPages).toBeGreaterThanOrEqual(3);
  for (let index = 1; index <= pdf.numPages; index++) {
    const pdfPage = await pdf.getPage(index);
    const viewport = pdfPage.getViewport({ scale: 1.25 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await pdfPage.render({ canvasContext: context as never, canvas: canvas as never, viewport }).promise;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let p = 0; p < pixels.length; p += 4) if (pixels[p]! < 230 && pixels[p + 1]! < 230 && pixels[p + 2]! < 230) ink++;
    expect(ink).toBeGreaterThan(1000);
    await writeFile(testInfo.outputPath(`pdf-page-${index}.png`), canvas.toBuffer('image/png'));
  }
  await loadingTask.destroy();
});
