import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '..', 'test-fixtures');
const images = [];

for (const name of ['documento-1', 'documento-2']) {
  const output = path.join(fixtures, `${name}.png`);
  await sharp(path.join(fixtures, `${name}.svg`)).png().toFile(output);
  images.push(output);
}

const pdf = await PDFDocument.create();
pdf.setTitle('Folio · prueba multipágina');
pdf.setAuthor('Cami-OS');
for (const imagePath of images) {
  const image = await pdf.embedJpg(await sharp(imagePath).jpeg({ quality: 94 }).toBuffer());
  const page = pdf.addPage([595.276, 841.89]);
  const scale = Math.min(559.276 / image.width, 805.89 / image.height);
  page.drawImage(image, {
    x: (595.276 - image.width * scale) / 2,
    y: (841.89 - image.height * scale) / 2,
    width: image.width * scale,
    height: image.height * scale,
  });
}
const { writeFile } = await import('node:fs/promises');
await writeFile(path.join(fixtures, 'documento-multipagina.pdf'), await pdf.save());
console.log('Fixtures generados: 2 PNG y 1 PDF multipágina');
