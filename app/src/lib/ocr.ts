import { createWorker, OEM, type LoggerMessage } from 'tesseract.js';
import type { PageRecord } from '../types';

function assetPaths() {
  const root = new URL('./tesseract/', window.location.href).href.replace(/\/$/, '');
  return {
    workerPath: `${root}/worker.min.js`,
    corePath: `${root}/core`,
    langPath: `${root}/lang`,
  };
}

export async function recognizePages(
  pages: PageRecord[],
  onProgress?: (page: number, total: number, progress: number, status: string) => void,
): Promise<string[]> {
  if (!pages.length) return [];
  let currentPage = 0;
  const worker = await createWorker(['spa', 'eng'], OEM.LSTM_ONLY, {
    ...assetPaths(),
    workerBlobURL: false,
    gzip: true,
    logger: (message: LoggerMessage) => {
      onProgress?.(currentPage + 1, pages.length, message.progress, message.status);
    },
  });

  const results: string[] = [];
  try {
    for (let index = 0; index < pages.length; index += 1) {
      currentPage = index;
      onProgress?.(index + 1, pages.length, 0, 'Preparando página');
      const result = await worker.recognize(pages[index].processed);
      results.push(result.data.text.trim());
      onProgress?.(index + 1, pages.length, 1, 'Texto reconocido');
    }
  } finally {
    await worker.terminate();
  }
  return results;
}
