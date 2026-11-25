import type { FolioDocument } from '../types';
import { safeFileName } from './files';

/* Escritor OOXML mínimo: un .docx editable sin dependencias.
   ZIP método STORE con tabla CRC32 (los textos son pequeños: no hace falta deflate). */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array }

export function buildZip(entries: ZipEntry[]): Blob {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();

  const writeU16 = (view: number[], value: number) => { view.push(value & 0xFF, (value >> 8) & 0xFF); };
  const writeU32 = (view: number[], value: number) => { view.push(value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >>> 24) & 0xFF); };

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const header: number[] = [];
    writeU32(header, 0x04034B50);
    writeU16(header, 20);
    writeU16(header, 0x0800); // nombres UTF-8
    writeU16(header, 0); // store
    writeU16(header, 0);
    writeU16(header, 0);
    writeU16(header, 0);
    writeU32(header, crc);
    writeU32(header, entry.data.length);
    writeU32(header, entry.data.length);
    writeU16(header, nameBytes.length);
    writeU16(header, 0);
    local.set(new Uint8Array(header), 0);
    local.set(nameBytes, 30);
    chunks.push(local, entry.data);

    const dir: number[] = [];
    writeU32(dir, 0x02014B50);
    writeU16(dir, 20);
    writeU16(dir, 20);
    writeU16(dir, 0x0800);
    writeU16(dir, 0);
    writeU16(dir, 0);
    writeU16(dir, 0);
    writeU32(dir, crc);
    writeU32(dir, entry.data.length);
    writeU32(dir, entry.data.length);
    writeU16(dir, nameBytes.length);
    writeU16(dir, 0);
    writeU16(dir, 0);
    writeU16(dir, 0);
    writeU16(dir, 0);
    writeU32(dir, 0);
    writeU32(dir, offset);
    central.push(new Uint8Array(dir), nameBytes);

    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end: number[] = [];
  writeU32(end, 0x06054B50);
  writeU16(end, 0);
  writeU16(end, 0);
  writeU16(end, entries.length);
  writeU16(end, entries.length);
  writeU32(end, centralSize);
  writeU32(end, offset);
  writeU16(end, 0);

  return new Blob([...chunks, ...central, new Uint8Array(end)] as unknown as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraph(text: string, bold = false, size = 22) {
  const run = escapeXml(text);
  return `<w:p><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${run}</w:t></w:r></w:p>`;
}

/** Genera un .docx editable con el texto OCR de cada página (100% local). */
export function documentWordFile(document: FolioDocument): { blob: Blob; fileName: string } {
  const parts: string[] = [paragraph(document.title, true, 32)];
  document.pages.forEach((page, index) => {
    const label = page.label ? ` (${page.label})` : '';
    parts.push(paragraph(`Página ${index + 1}${label}`, true, 24));
    const text = page.ocrText.trim() || '[Página sin texto reconocido: ejecuta el OCR primero]';
    for (const line of text.split(/\r?\n/)) {
      parts.push(paragraph(line.trim() || ''));
    }
    if (index < document.pages.length - 1) parts.push(paragraph(''));
  });

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    },
    {
      name: '_rels/.rels',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    },
    {
      name: 'word/styles.xml',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style></w:styles>`),
    },
    {
      name: 'docProps/core.xml',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(document.title)}</dc:title><dc:creator>Folio — Powered by Cami-OS</dc:creator><cp:lastModifiedBy>Folio — Powered by Cami-OS</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
    },
    {
      name: 'word/document.xml',
      data: new TextEncoder().encode(documentXml),
    },
  ];

  return { blob: buildZip(entries), fileName: `${safeFileName(document.title)}.docx` };
}
