import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixtures = path.join(root, 'test-fixtures');
const shots = path.join(root, 'qa-shots');
const output = path.join(root, 'qa-output');

async function shot(page: import('@playwright/test').Page, name: string, fullPage = true) {
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage });
}

async function waitForNewImage(page: import('@playwright/test').Page, previous: string, action: () => Promise<void>) {
  await action();
  await expect.poll(() => page.locator('.processed-page img').getAttribute('src'), { timeout: 120_000 }).not.toBe(previous);
  await expect(page.locator('.processing-cover')).toHaveCount(0, { timeout: 120_000 });
}

async function enterEditor(page: import('@playwright/test').Page) {
  if (await page.locator('.document-reader').count()) {
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
  }
  await expect(page.locator('.processed-page img')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.processing-cover')).toHaveCount(0);
}

async function backToLibrary(page: import('@playwright/test').Page) {
  if (await page.getByRole('button', { name: 'Volver al lector', exact: true }).count()) {
    await page.getByRole('button', { name: 'Volver al lector', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Volver a biblioteca', exact: true }).click();
  await expect(page.locator('.shell-main')).toBeVisible();
}

async function waitForPdfPreview(page: import('@playwright/test').Page) {
  await expect(page.getByRole('dialog', { name: 'Exportar PDF' })).toBeVisible();
  await expect(page.locator('.pdf-preview-loading')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(() => page.locator('.pdf-preview-canvas canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width), { timeout: 120_000 }).toBeGreaterThan(100);
  await expect(page.getByRole('button', { name: 'Crear y guardar PDF' })).toBeEnabled();
}

test('flujo documental completo, local y persistente', async ({ page }) => {
  test.setTimeout(900_000);
  await mkdir(output, { recursive: true });
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4173')) external.push(url);
  });

  await page.goto('/');
  await expect(page.locator('.quick-grid')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recientes' })).toBeVisible();
  await shot(page, '01-inicio-1440-claro');

  await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Apariencia' })).toBeVisible();
  await page.getByRole('button', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot(page, '02-ajustes-1440-oscuro');
  await page.getByRole('button', { name: 'Claro' }).click();
  await page.getByRole('button', { name: 'Inicio', exact: true }).first().click();

  const choose = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar imágenes', exact: true }).first().click();
  await (await choose).setFiles(path.join(fixtures, 'documento-1.png'));
  try {
    await expect(page.locator('.reader-sheet img')).toBeVisible({ timeout: 120_000 });
  } catch (error) {
    console.log('ERRORES DEL NAVEGADOR', errors);
    console.log('ESTADO AL IMPORTAR', (await page.locator('body').innerText()).slice(-1800));
    throw error;
  }
  await expect(page.locator('.reader-thumbnail')).toHaveCount(1);
  await expect(page.locator('.processing-cover, .reader-busy')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Nombre del documento' }).fill('Factura de prueba');
  await shot(page, '03-lector-importado-1440');
  await page.getByRole('button', { name: 'Una página', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Una página', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Acercar documento' }).click();
  await expect(page.getByRole('button', { name: 'Ajustar zoom al 100 por ciento' })).toHaveText('115%');
  await page.getByRole('button', { name: 'Ajustar zoom al 100 por ciento' }).click();
  await page.getByRole('button', { name: 'Continuo', exact: true }).click();
  await enterEditor(page);
  await shot(page, '03b-editor-importado-1440');

  // C1: Escape retrocede una capa cada vez: edición → lectura → biblioteca.
  await page.keyboard.press('Escape');
  await expect(page.locator('.document-reader')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell-main')).toBeVisible();
  await page.getByRole('button', { name: 'Documentos', exact: true }).first().click();
  await page.getByRole('button', { name: 'Abrir Factura de prueba' }).click();
  await expect(page.locator('.reader-sheet img')).toBeVisible();
  await enterEditor(page);

  let previous = await page.locator('.processed-page img').getAttribute('src');
  await waitForNewImage(page, previous!, () => page.getByRole('button', { name: 'Auto', exact: true }).click());
  await shot(page, '04-editor-recorte-auto-1440');

  previous = await page.locator('.processed-page img').getAttribute('src');
  await waitForNewImage(page, previous!, () => page.getByRole('button', { name: 'Mágico', exact: true }).click());
  for (let turn = 0; turn < 4; turn += 1) {
    previous = await page.locator('.processed-page img').getAttribute('src');
    await waitForNewImage(page, previous!, () => page.getByRole('button', { name: 'Girar', exact: true }).click());
  }

  await page.getByRole('button', { name: 'Recortar', exact: true }).click();
  await expect(page.locator('.crop-stage')).toBeVisible();
  await shot(page, '05-recorte-manual-1440');
  const firstHandle = page.locator('.crop-stage circle').first();
  const handleBox = await firstHandle.boundingBox();
  if (!handleBox) throw new Error('No se encontró la primera esquina de recorte');
  const oldPolygon = await page.locator('.crop-stage polygon').getAttribute('points');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 12, handleBox.y + handleBox.height / 2 + 12, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.locator('.crop-stage polygon').getAttribute('points')).not.toBe(oldPolygon);
  await page.getByRole('button', { name: 'Detectar bordes' }).click();
  previous = await page.locator('.processed-page img').count() ? await page.locator('.processed-page img').getAttribute('src') : '';
  await page.getByRole('button', { name: 'Aplicar recorte' }).click();
  await expect(page.locator('.crop-stage')).toHaveCount(0);
  await expect(page.locator('.processing-cover')).toHaveCount(0, { timeout: 120_000 });

  await page.getByRole('button', { name: 'Esta página', exact: true }).click();
  await expect(page.getByText('OCR terminado y guardado. Ya puedes buscar, exportar Word o traducir.')).toBeVisible({ timeout: 180_000 });
  const ocr = await page.getByRole('textbox', { name: 'Texto OCR editable' }).inputValue();
  expect(ocr).toMatch(/FOLIO/i);
  expect(ocr).toMatch(/Tunja/i);
  await shot(page, '06-editor-ocr-1440');

  // C8: Word editable local (.docx) desde el menú de tres puntos.
  const wordDownload = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('menuitem', { name: 'Exportar Word editable' }).click();
  const word = await wordDownload;
  const wordPath = path.join(output, 'factura-prueba.docx');
  await word.saveAs(wordPath);
  const wordBytes = await readFile(wordPath);
  expect(wordBytes.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(wordBytes.toString('latin1')).toContain('word/document.xml');
  expect(wordBytes.toString('latin1')).toContain('Factura de prueba');

  const pdfDownload = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
  await waitForPdfPreview(page);
  await shot(page, '07-opciones-pdf-1440');
  await page.getByRole('button', { name: 'Crear y guardar PDF' }).click();
  const pdf = await pdfDownload;
  const pdfPath = path.join(output, 'factura-prueba.pdf');
  await pdf.saveAs(pdfPath);
  const pdfBytes = await readFile(pdfPath);
  const parsed = await PDFDocument.load(pdfBytes);
  expect(parsed.getPageCount()).toBe(1);
  expect(parsed.getTitle()).toBe('Factura de prueba');

  const txtDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.getByRole('menuitem', { name: 'Exportar texto (.txt)' }).click();
  const txt = await txtDownload;
  const txtPath = path.join(output, 'factura-prueba.txt');
  await txt.saveAs(txtPath);
  expect(await readFile(txtPath, 'utf8')).toMatch(/FOLIO/i);

  await backToLibrary(page);
  await page.getByRole('button', { name: 'Documentos', exact: true }).first().click();
  await expect(page.locator('.document-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Añadir a favoritos' }).click();
  await expect(page.getByRole('button', { name: 'Quitar de favoritos' })).toBeVisible();
  await page.getByRole('button', { name: 'Duplicar documento' }).click();
  await expect(page.locator('.document-card')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Buscar documentos' }).fill('Tunja');
  await expect(page.locator('.document-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await shot(page, '08-documentos-1440');

  const cards = page.locator('.document-card');
  await cards.nth(0).locator('.select-check').click();
  await cards.nth(1).locator('.select-check').click();
  await page.getByRole('button', { name: 'Combinar', exact: true }).click();
  await expect(page.locator('.reader-thumbnail')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Nombre del documento' })).toHaveValue('Documento combinado');
  await enterEditor(page);
  await expect(page.locator('.page-thumb')).toHaveCount(2);

  await page.getByRole('button', { name: 'Duplicar', exact: true }).click();
  await expect(page.locator('.page-thumb')).toHaveCount(3);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.locator('.page-thumb')).toHaveCount(2);

  const mergedDownload = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
  await waitForPdfPreview(page);
  await page.getByRole('button', { name: 'Crear y guardar PDF' }).click();
  const merged = await mergedDownload;
  const mergedPath = path.join(output, 'documento-combinado.pdf');
  await merged.saveAs(mergedPath);
  expect((await PDFDocument.load(await readFile(mergedPath))).getPageCount()).toBe(2);

  for (const width of [390, 768, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `09-editor-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await backToLibrary(page);
  await page.getByRole('button', { name: 'Documentos', exact: true }).first().click();
  await expect(page.locator('.document-card')).toHaveCount(3);
  await page.reload();
  await page.getByRole('button', { name: 'Documentos', exact: true }).first().click();
  await expect(page.locator('.document-card')).toHaveCount(3);

  const pdfChoose = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar archivos', exact: true }).first().click();
  await (await pdfChoose).setFiles(path.join(fixtures, 'documento-multipagina.pdf'));
  await expect(page.locator('.reader-thumbnail')).toHaveCount(2, { timeout: 120_000 });
  await page.getByRole('button', { name: 'Una página', exact: true }).click();
  await page.getByRole('button', { name: 'Página siguiente', exact: true }).click();
  await expect(page.locator('.reader-page-nav')).toContainText('2 / 2');
  await expect(page.locator('.reader-sheet')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ir a página 1', exact: true }).click();
  await expect(page.locator('.reader-page-nav')).toContainText('1 / 2');
  await shot(page, '10-importacion-pdf-1440');
  await backToLibrary(page);
  await page.getByRole('button', { name: 'Documentos', exact: true }).first().click();
  await expect(page.locator('.document-card')).toHaveCount(4);

  await page.getByRole('button', { name: 'Herramientas', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Importar', exact: true })).toBeVisible();
  await shot(page, '11-herramientas-1440');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
  await shot(page, '12-ajustes-1440');

  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('blanqueado mágico con sombra y Excel real', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4173')) external.push(url);
  });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  const choose = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar imágenes', exact: true }).first().click();
  await (await choose).setFiles(path.join(fixtures, 'documento-sombra.jpg'));
  await expect(page.locator('.reader-sheet img')).toBeVisible({ timeout: 180_000 });
  await enterEditor(page);

  // Aplica el filtro Mágico: el papel con sombra debe quedar blanco y parejo.
  const before = await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('.processed-page img');
    const canvas = document.createElement('canvas');
    canvas.width = image!.naturalWidth;
    canvas.height = image!.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image!, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let index = 0; index < data.length; index += 400) sum += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    return sum / (data.length / 400);
  });
  const previous = await page.locator('.processed-page img').getAttribute('src');
  await waitForNewImage(page, previous!, () => page.getByRole('button', { name: 'Mágico', exact: true }).click());
  const after = await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('.processed-page img');
    const canvas = document.createElement('canvas');
    canvas.width = image!.naturalWidth;
    canvas.height = image!.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image!, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let index = 0; index < data.length; index += 400) sum += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    return sum / (data.length / 400);
  });
  await shot(page, '13-blanqueado-magico-1440');
  expect(after, `el papel debe aclarar con Mágico: antes ${before}, después ${after}`).toBeGreaterThan(before + 12);
  expect(after).toBeGreaterThan(195);

  // A Excel con OCR automático y .xlsx válido (edición → lector → biblioteca).
  await page.keyboard.press('Escape');
  await expect(page.locator('.document-reader')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell-main')).toBeVisible();
  await page.getByRole('button', { name: 'Herramientas', exact: true }).first().click();
  await page.getByRole('button', { name: 'A Excel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Elegir documento' })).toBeVisible();
  await page.locator('.picker-row').first().click();
  const excelDownload = page.waitForEvent('download', { timeout: 240_000 });
  const excel = await excelDownload;
  const excelPath = path.join(output, 'hoja-sombra.xlsx');
  await excel.saveAs(excelPath);
  const excelBytes = await readFile(excelPath);
  expect(excelBytes.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(excelBytes.toString('latin1')).toContain('xl/worksheets/sheet1.xml');

  expect(external.filter((url) => !url.includes('mymemory')).map((url) => url.split('?')[0])).toEqual([]);
  expect(errors).toEqual([]);
});

test('pestañas responsive en claro y oscuro', async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('.quick-grid')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `responsive-inicio-${width}-claro`);
    await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
    await page.getByRole('button', { name: 'Oscuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await shot(page, `responsive-ajustes-${width}-oscuro`);
    await page.getByRole('button', { name: 'Documentos', exact: true }).first().click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `responsive-documentos-${width}-oscuro`);
  }
});
