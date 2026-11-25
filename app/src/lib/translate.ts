/* Traducción OPT-IN: solo se llama cuando Cami pulsa Permitir en el aviso.
   Usa la API gratuita de MyMemory (sin clave, límite diario amable).
   El resto de Folio sigue sin internet. */

export const TRANSLATION_LANGUAGES = [
  { value: 'en', label: 'Inglés' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Portugués' },
  { value: 'fr', label: 'Francés' },
  { value: 'it', label: 'Italiano' },
] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number]['value'];

const MAX_CHUNK = 480;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of text.split(/\n+/)) {
    const piece = paragraph.trim();
    if (!piece) continue;
    if ((current + ' ' + piece).trim().length > MAX_CHUNK) {
      if (current) chunks.push(current.trim());
      current = piece;
    } else {
      current = (current + ' ' + piece).trim();
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.slice(0, 20);
}

/** Traduce texto con MyMemory; lanza con mensaje claro si el servicio falla o no hay red. */
export async function translateText(text: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string> {
  const clean = text.trim();
  if (!clean) throw new Error('No hay texto que traducir');
  if (from === to) return clean;
  const chunks = chunkText(clean);
  if (!chunks.length) throw new Error('No hay texto que traducir');
  const translated: string[] = [];
  for (const chunk of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${from}|${to}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new Error('No hay internet para traducir. La traducción es la única función que lo necesita.');
    }
    if (!response.ok) throw new Error(`El servicio de traducción respondió ${response.status}`);
    const data = (await response.json()) as { responseData?: { translatedText?: string }; responseStatus?: number | string };
    const output = data.responseData?.translatedText;
    if (!output) throw new Error('La traducción llegó vacía, intenta de nuevo');
    translated.push(output);
  }
  return translated.join('\n\n');
}
