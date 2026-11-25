import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { canvasToBlob } from './image';

GlobalWorkerOptions.workerPort = new PdfWorker();

export async function importPdfPages(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data });
  const pdf = await task.promise;
  const images: Blob[] = [];

  try {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.4, 2100 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false })!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      images.push(await canvasToBlob(canvas, 'image/jpeg', 0.94));
      page.cleanup();
      onProgress?.(number, pdf.numPages);
    }
  } finally {
    await task.destroy();
  }
  return images;
}
