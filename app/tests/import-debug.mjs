import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on('console', (message) => console.log('CONSOLE', message.type(), message.text()));
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
page.on('requestfailed', (request) => console.log('FAILED', request.url(), request.failure()?.errorText));
page.on('response', (response) => { if (/opencv|wasm/i.test(response.url())) console.log('RESPONSE', response.status(), response.url()); });
page.on('request', (request) => { if (/opencv|wasm/i.test(request.url())) console.log('REQUEST', request.url()); });
await page.goto('http://127.0.0.1:4173');
const choose = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /Importar imagen o PDF/ }).click();
await (await choose).setFiles(path.join(root, 'test-fixtures', 'documento-1.png'));
for (let second = 1; second <= 20; second += 1) {
  await page.waitForTimeout(1000);
  const body = (await page.locator('body').innerText()).slice(-700).replaceAll('\n', ' | ');
  console.log('SECOND', second, body);
  if (second === 2 || second === 5) await page.screenshot({ path: path.join(root, 'qa-shots', `debug-importacion-${second}s.png`), fullPage: true });
}
console.log('DEBUG_STATE', await page.evaluate(() => ({
  scripts: Array.from(document.scripts).map((script) => ({ src: script.src, folio: script.dataset.folioOpencv, loaded: script.dataset.loaded })),
  cv: { type: typeof window.cv, then: typeof window.cv?.then, mat: typeof window.cv?.Mat },
})));
await browser.close();
