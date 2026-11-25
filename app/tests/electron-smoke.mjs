import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { _electron as electron, expect } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shots = path.join(root, 'qa-shots');
await mkdir(shots, { recursive: true });
const errors = [];
const external = [];
let app;

try {
  app = await electron.launch({
    executablePath: path.join(root, 'release', 'win-unpacked', 'Folio.exe'),
    timeout: 120_000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) external.push(request.url());
  });
  await expect(page.getByRole('heading', { name: /Tu papel/ })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: path.join(shots, 'electron-01-biblioteca.png'), fullPage: true });
  const choose = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Importar imagen o PDF/ }).click();
  await (await choose).setFiles(path.join(root, 'test-fixtures', 'documento-1.png'));
  await expect(page.locator('.processed-page img')).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: path.join(shots, 'electron-02-editor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Esta página', exact: true }).click();
  await expect(page.getByText('OCR terminado y guardado. Ya puedes buscar o corregir el texto.')).toBeVisible({ timeout: 180_000 });
  expect(await page.getByRole('textbox', { name: 'Texto OCR editable' }).inputValue()).toMatch(/FOLIO/i);
  await page.screenshot({ path: path.join(shots, 'electron-03-ocr.png'), fullPage: true });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(path.join(root, 'qa-output', 'electron-smoke.json'), JSON.stringify({ ok: true, errors, external }, null, 2));
  console.log('Electron empaquetado: biblioteca, OpenCV y OCR local verificados');
} catch (error) {
  await writeFile(path.join(root, 'qa-output', 'electron-smoke.json'), JSON.stringify({ ok: false, error: String(error), errors, external }, null, 2));
  throw error;
} finally {
  await app?.close();
}
