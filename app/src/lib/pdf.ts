import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { FolioDocument, PdfOptions } from '../types';
import { canvasToBlob } from './image';
import { safeFileName } from './files';

const PAPER_SIZES = {
  a4: [595.276, 841.89],
  letter: [612, 792],
} as const;

function asBytes(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function blobFromBytes(bytes: Uint8Array, type: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

function splitText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      try {
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      } catch {
        line = candidate.replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '?');
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawInvisibleText(page: PDFPage, text: string, font: PDFFont, width: number, height: number, margin: number) {
  const size = 8;
  const lines = splitText(text, font, size, width - margin * 2).slice(0, Math.floor((height - margin * 2) / 11));
  let y = height - margin;
  for (const line of lines) {
    try {
      page.drawText(line, { x: margin, y, size, font, color: rgb(1, 1, 1), opacity: 0 });
    } catch {
      page.drawText(line.replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '?'), {
        x: margin, y, size, font, color: rgb(1, 1, 1), opacity: 0,
      });
    }
    y -= 11;
  }
}

export async function createDocumentPdf(
  folioDocument: FolioDocument,
  options: PdfOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const output = await PDFDocument.create();
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  output.setTitle(folioDocument.title);
  output.setAuthor('Folio — Powered by Cami-OS');
  output.setCreator('Folio');
  output.setProducer('Folio / Cami-OS');
  output.setCreationDate(new Date());
  output.setModificationDate(new Date());

  for (let index = 0; index < folioDocument.pages.length; index += 1) {
    const sourcePage = folioDocument.pages[index];
    const canvas = window.document.createElement('canvas');
    const bitmap = await createImageBitmap(sourcePage.processed);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', options.quality);
    const image = await output.embedJpg(await asBytes(jpeg));

    let width: number;
    let height: number;
    if (options.paper === 'original') {
      width = (image.width * 72) / 150 + options.margin * 2;
      height = (image.height * 72) / 150 + options.margin * 2;
    } else {
      [width, height] = PAPER_SIZES[options.paper];
      const landscape = options.orientation === 'landscape'
        || (options.orientation === 'auto' && image.width > image.height * 1.12);
      if (landscape) [width, height] = [height, width];
    }
    const page = output.addPage([width, height]);
    const reservedBottom = options.pageNumbers ? 14 : 0;
    const availableWidth = Math.max(24, width - options.margin * 2);
    const availableHeight = Math.max(24, height - options.margin * 2 - reservedBottom);
    const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight + reservedBottom) / 2;
    page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });

    if (options.watermark.trim()) {
      const watermark = options.watermark.trim().slice(0, 90);
      const size = Math.max(16, Math.min(34, width / 20));
      page.drawText(watermark, {
        x: width / 2 - bold.widthOfTextAtSize(watermark, size) / 2,
        y: height / 2,
        size,
        font: bold,
        color: rgb(0.25, 0.22, 0.17),
        opacity: 0.16,
        rotate: degrees(-28),
      });
    }
    if (options.pageNumbers) {
      const label = `${index + 1} / ${folioDocument.pages.length}`;
      page.drawText(label, {
        x: width / 2 - regular.widthOfTextAtSize(label, 8) / 2,
        y: Math.max(7, options.margin / 2),
        size: 8,
        font: regular,
        color: rgb(0.35, 0.33, 0.3),
      });
    }
    if (options.includeOcr && sourcePage.ocrText.trim()) {
      drawInvisibleText(page, sourcePage.ocrText, regular, width, height, options.margin);
    }
    onProgress?.(index + 1, folioDocument.pages.length);
  }

  return blobFromBytes(await output.save(), 'application/pdf');
}

export function pdfFileName(document: FolioDocument) {
  return `${safeFileName(document.title)}.pdf`;
}
