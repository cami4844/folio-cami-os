export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export type Rotation = 0 | 90 | 180 | 270;
export type FilterMode = 'original' | 'color' | 'gray' | 'bw';
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface PageRecord {
  id: string;
  original: Blob;
  processed: Blob;
  thumbnail: Blob;
  width: number;
  height: number;
  quad: Quad;
  rotation: Rotation;
  filter: FilterMode;
  label?: string;
  ocrText: string;
  createdAt: number;
}

export interface FolioDocument {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  favorite: boolean;
  pages: PageRecord[];
}

export interface PdfOptions {
  paper: 'a4' | 'letter' | 'original';
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: number;
  quality: number;
  pageNumbers: boolean;
  watermark: string;
  includeOcr: boolean;
}

export interface DesktopSaveResult {
  canceled: boolean;
  path?: string;
  error?: string;
}

export interface DesktopApi {
  saveFile(data: ArrayBuffer, fileName: string, filters?: { name: string; extensions: string[] }[]): Promise<DesktopSaveResult>;
  platform: string;
}

export const FULL_QUAD: Quad = [
  { x: 0.025, y: 0.025 },
  { x: 0.975, y: 0.025 },
  { x: 0.975, y: 0.975 },
  { x: 0.025, y: 0.975 },
];

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  paper: 'a4',
  orientation: 'auto',
  margin: 18,
  quality: 0.9,
  pageNumbers: true,
  watermark: '',
  includeOcr: true,
};

export const newId = () => crypto.randomUUID();
