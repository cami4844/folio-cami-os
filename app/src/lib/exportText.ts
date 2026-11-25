import type { FolioDocument } from '../types';
import { safeFileName } from './files';

export function documentText(document: FolioDocument) {
  return document.pages
    .map((page, index) => `Página ${index + 1}\n${page.ocrText.trim() || '[Sin texto reconocido]'}`)
    .join('\n\n---\n\n');
}

export function documentTextFile(document: FolioDocument) {
  return {
    blob: new Blob([documentText(document)], { type: 'text/plain;charset=utf-8' }),
    fileName: `${safeFileName(document.title)} - OCR.txt`,
  };
}
