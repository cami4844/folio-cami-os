import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export function safeFileName(value: string) {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ');
  return cleaned || 'Documento Folio';
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function saveOrShare(blob: Blob, fileName: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const relativePath = `exports/${Date.now()}-${safeFileName(fileName)}`;
    const file = await Filesystem.writeFile({
      path: relativePath,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({ title: fileName, files: [file.uri], dialogTitle: 'Compartir documento' });
    return 'Listo para compartir';
  }

  if (window.folioDesktop) {
    const extension = fileName.split('.').pop()?.toLowerCase() ?? 'bin';
    const result = await window.folioDesktop.saveFile(await blob.arrayBuffer(), fileName, [
      { name: extension.toUpperCase(), extensions: [extension] },
    ]);
    if (result.error) throw new Error(result.error);
    return result.canceled ? 'Guardado cancelado' : `Guardado en ${result.path}`;
  }

  downloadBlob(blob, fileName);
  return `Descargado: ${fileName}`;
}
