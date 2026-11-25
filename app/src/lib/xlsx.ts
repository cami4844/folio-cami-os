import type { FolioDocument } from '../types';
import { safeFileName } from './files';
import { buildZip, type ZipEntry } from './docx';

/* Hoja de cálculo OOXML mínima (.xlsx) 100% local: una fila por línea de texto,
   columnas separadas por tabulaciones o dos+ espacios (las celdas van inline). */

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitColumns(line: string): string[] {
  const byTabs = line.split('\t').map((part) => part.trim()).filter(Boolean);
  if (byTabs.length > 1) return byTabs;
  const bySpaces = line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
  return bySpaces.length > 1 ? bySpaces : [line.trim()];
}

function cell(ref: string, text: string) {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function sheetRows(document: FolioDocument): string[] {
  const rows: string[] = [];
  rows.push(`<row r="1">${cell('A1', 'Página')}${cell('B1', 'Etiqueta')}${cell('C1', 'Texto')}</row>`);
  let rowNumber = 2;
  document.pages.forEach((page, index) => {
    const label = page.label ?? '';
    const text = page.ocrText.trim() || '[Sin texto reconocido]';
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const columns = splitColumns(line);
      const cells = [cell(`A${rowNumber}`, String(index + 1)), cell(`B${rowNumber}`, label)];
      columns.forEach((column, columnIndex) => {
        cells.push(cell(`${String.fromCharCode(67 + Math.min(columnIndex, 13))}${rowNumber}`, column));
      });
      rows.push(`<row r="${rowNumber}">${cells.join('')}</row>`);
      rowNumber += 1;
    }
  });
  return rows;
}

/** Genera un .xlsx editable con el texto OCR en filas y columnas (100% local). */
export function documentExcelFile(document: FolioDocument): { blob: Blob; fileName: string } {
  const rows = sheetRows(document);
  const dimension = rows.length || 1;
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    },
    {
      name: '_rels/.rels',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    },
    {
      name: 'xl/workbook.xml',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OCR" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C${dimension}"/><sheetData>${rows.join('')}</sheetData><cols><col min="1" max="1" width="10"/><col min="2" max="2" width="16"/><col min="3" max="16" width="42"/></cols></worksheet>`),
    },
  ];
  return { blob: buildZip(entries), fileName: `${safeFileName(document.title)}.xlsx` };
}
