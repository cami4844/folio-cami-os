import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { _electron as electron, expect } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const executablePath = process.argv[2] || path.join(root, 'release', 'win-unpacked', 'Folio.exe');
const label = process.argv[3] || 'windows-instalado';
const startupOnly = process.argv.includes('--startup-only');
const output = path.join(root, 'qa-output', label);
const profile = path.join(output, 'perfil-aislado');
const fixture = path.join(root, 'test-fixtures', 'documento-1.png');
await mkdir(output, { recursive: true });

const errors = [];
const external = [];
const report = {
  executablePath,
  startupOnly,
  startedAt: new Date().toISOString(),
  checks: {},
};

const electronApp = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${profile}`],
  timeout: 120_000,
});

try {
  const page = await electronApp.firstWindow({ timeout: 120_000 });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) external.push(request.url());
  });

  await expect(page.locator('.quick-grid')).toBeVisible({ timeout: 120_000 });
  const bridge = await page.evaluate(() => ({
    platform: window.folioDesktop?.platform,
    require: typeof window.require,
    process: typeof window.process,
  }));
  if (bridge.platform !== 'win32' || bridge.require !== 'undefined' || bridge.process !== 'undefined') {
    throw new Error(`Puente Electron inesperado: ${JSON.stringify(bridge)}`);
  }
  report.checks.secureBridge = bridge;
  await page.screenshot({ path: path.join(output, '01-biblioteca-claro.png'), fullPage: true });

  await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
  await page.getByRole('button', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: path.join(output, '02-ajustes-oscuro.png'), fullPage: true });
  await page.getByRole('button', { name: 'Claro' }).click();
  await page.getByRole('button', { name: 'Inicio', exact: true }).first().click();
  report.checks.theme = true;

  if (!startupOnly) {
    const chooserEvent = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Importar imágenes', exact: true }).first().click();
    const chooser = await chooserEvent;
    await chooser.setFiles(fixture);
    await expect(page.locator('.reader-sheet img')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.reader-busy')).toHaveCount(0, { timeout: 120_000 });
    await page.getByRole('textbox', { name: 'Nombre del documento' }).fill('Prueba nativa Folio');
    await page.screenshot({ path: path.join(output, '03-lector-documento.png'), fullPage: true });
    report.checks.imageImport = true;

    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(page.locator('.processed-page img')).toBeVisible();
    await page.getByRole('button', { name: 'Esta página', exact: true }).click();
    await expect(page.getByText('OCR terminado y guardado. Ya puedes buscar, exportar Word o traducir.')).toBeVisible({ timeout: 180_000 });
    expect(await page.getByRole('textbox', { name: 'Texto OCR editable' }).inputValue()).toMatch(/FOLIO/i);
    report.checks.ocr = true;

    const textPath = path.join(output, 'prueba-nativa.txt');
    await electronApp.evaluate(async ({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, textPath);
    await page.getByRole('button', { name: 'Más opciones' }).click();
    await page.getByRole('menuitem', { name: 'Exportar texto (.txt)' }).click();
    await expect(page.getByText(/Guardado en .*prueba-nativa\.txt/)).toBeVisible({ timeout: 30_000 });
    const text = await readFile(textPath, 'utf8');
    if (!/Factura F-2026-001/.test(text) || !/DOCUMENTO DE PRUEBA/i.test(text)) throw new Error('El TXT nativo no contiene el OCR esperado');
    report.checks.txtExport = { bytes: Buffer.byteLength(text), path: textPath };

    const pdfPath = path.join(output, 'prueba-nativa.pdf');
    await electronApp.evaluate(async ({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, pdfPath);
    await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
    await expect(page.locator('.pdf-preview-loading')).toHaveCount(0, { timeout: 120_000 });
    await expect.poll(() => page.locator('.pdf-preview-canvas canvas').evaluate((canvas) => canvas.width), { timeout: 120_000 }).toBeGreaterThan(100);
    await page.screenshot({ path: path.join(output, '04-vista-previa-pdf.png'), fullPage: true });
    await page.getByRole('button', { name: 'Crear y guardar PDF' }).click();
    await expect(page.getByText(/Guardado en .*prueba-nativa\.pdf/)).toBeVisible({ timeout: 120_000 });
    const pdf = await readFile(pdfPath);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('La exportación nativa no produjo un PDF válido');
    report.checks.pdfExport = { bytes: pdf.byteLength, path: pdfPath };
  }

  if (errors.length) throw new Error(`Errores de consola: ${errors.join(' | ')}`);
  if (external.length) throw new Error(`Solicitudes externas inesperadas: ${external.join(' | ')}`);
  report.checks.consoleErrors = errors;
  report.checks.externalRequests = external;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.stack : String(error);
  report.checks.consoleErrors = errors;
  report.checks.externalRequests = external;
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'resultado.json'), JSON.stringify(report, null, 2), 'utf8');
  await electronApp.close();
}

console.log(JSON.stringify(report, null, 2));
