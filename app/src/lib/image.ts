import { FULL_QUAD, newId, type FilterMode, type PageRecord, type Quad, type Rotation } from '../types';
import { getOpenCv } from './opencv';
import { analyzeQuadFromCanvas, detectQuadFromCanvas } from './documentDetection';
import { enhanceDocument } from './documentEnhance';
import { quadGeometryError } from './quadGeometry';

export { detectQuadFromCanvas } from './documentDetection';
export type { DocumentDetection } from './documentDetection';

const MAX_IMAGE_EDGE = 2600;
const DETECT_EDGE = 960;
const LIVE_DETECT_EDGE = 448;

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo codificar la imagen'))), type, quality);
  });
}

async function bitmapFrom(blob: Blob) {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

function canvasFromBitmap(bitmap: ImageBitmap, maxEdge = Number.POSITIVE_INFINITY) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export async function canvasFromBlob(blob: Blob, maxEdge = Number.POSITIVE_INFINITY) {
  return canvasFromBitmap(await bitmapFrom(blob), maxEdge);
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function orderQuad(points: { x: number; y: number }[]): Quad {
  if (points.length !== 4) throw new Error('Se necesitan cuatro esquinas');
  const sorted = [...points].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function rotateCanvas(source: HTMLCanvasElement, rotation: Rotation) {
  if (rotation === 0) return source;
  const canvas = document.createElement('canvas');
  canvas.width = rotation % 180 === 0 ? source.width : source.height;
  canvas.height = rotation % 180 === 0 ? source.height : source.width;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

async function warp(source: HTMLCanvasElement, quad: Quad) {
  const geometryError = quadGeometryError(quad);
  if (geometryError) throw new Error(geometryError);
  const points = quad.map((point) => ({ x: point.x * source.width, y: point.y * source.height }));
  const width = Math.max(24, Math.round(Math.max(distance(points[0], points[1]), distance(points[3], points[2]))));
  const height = Math.max(24, Math.round(Math.max(distance(points[0], points[3]), distance(points[1], points[2]))));
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const outputWidth = Math.max(24, Math.round(width * scale));
  const outputHeight = Math.max(24, Math.round(height * scale));
  const destination = document.createElement('canvas');
  destination.width = outputWidth;
  destination.height = outputHeight;

  const tolerance = Math.max(source.width, source.height) * 0.002;
  const axisAligned = Math.abs(points[0].y - points[1].y) <= tolerance
    && Math.abs(points[3].y - points[2].y) <= tolerance
    && Math.abs(points[0].x - points[3].x) <= tolerance
    && Math.abs(points[1].x - points[2].x) <= tolerance;
  if (axisAligned) {
    const left = Math.max(0, Math.min(points[0].x, points[3].x));
    const top = Math.max(0, Math.min(points[0].y, points[1].y));
    const right = Math.min(source.width, Math.max(points[1].x, points[2].x));
    const bottom = Math.min(source.height, Math.max(points[3].y, points[2].y));
    const context = destination.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.drawImage(source, left, top, right - left, bottom - top, 0, 0, outputWidth, outputHeight);
    return destination;
  }

  const cv = await getOpenCv();
  const input = cv.imread(source);
  const output = new cv.Mat();
  const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, points.flatMap((point) => [point.x, point.y]));
  const destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, outputWidth - 1, 0, outputWidth - 1, outputHeight - 1, 0, outputHeight - 1,
  ]);
  let transform: InstanceType<OpenCvMat> | undefined;
  try {
    transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);
    cv.warpPerspective(
      input,
      output,
      transform,
      new cv.Size(outputWidth, outputHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255),
    );
    cv.imshow(destination, output);
  } finally {
    input.delete();
    output.delete();
    sourcePoints.delete();
    destinationPoints.delete();
    transform?.delete();
  }
  return destination;
}

type OpenCvMat = import('./opencv').OpenCv['Mat'];

/* ===== Detección de bordes (v2) ===== */

interface QuadCandidate { area: number; score: number; quad: Quad }

function quadScore(points: { x: number; y: number }[], fullArea: number, area: number) {
  // Puntúa qué tan "rectangular y completa" es la figura: lados paralelos + tamaño.
  const d = (a: number, b: number) => distance(points[a], points[b]);
  const top = d(0, 1);
  const bottom = d(3, 2);
  const left = d(0, 3);
  const right = d(1, 2);
  const horizontal = Math.min(top, bottom) / Math.max(top, bottom);
  const vertical = Math.min(left, right) / Math.max(left, right);
  const fill = Math.min(1, area / (fullArea * 0.35));
  return horizontal * 0.3 + vertical * 0.3 + Math.min(1, fill) * 0.4;
}

function collectQuads(cv: import('./opencv').OpenCv, binary: InstanceType<OpenCvMat>, canvas: HTMLCanvasElement): QuadCandidate[] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const candidates: QuadCandidate[] = [];
  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const fullArea = canvas.width * canvas.height;
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      let approximation: InstanceType<OpenCvMat> | undefined;
      try {
        const area = cv.contourArea(contour, false);
        if (area < fullArea * 0.05) continue;
        const perimeter = cv.arcLength(contour, true);
        approximation = new cv.Mat();
        cv.approxPolyDP(contour, approximation, perimeter * 0.03, true);
        if (approximation.rows < 4 || approximation.rows > 8) continue;
        const values = approximation.data32S;
        if (approximation.rows === 4) {
          const points = Array.from({ length: 4 }, (_, point) => ({
            x: Math.max(0, Math.min(1, values[point * 2] / canvas.width)),
            y: Math.max(0, Math.min(1, values[point * 2 + 1] / canvas.height)),
          }));
          candidates.push({ area, score: quadScore(points, fullArea, area), quad: orderQuad(points) });
        } else {
          // Caja que envuelve figuras de 5-8 vértices (hojas con esquinas dobladas).
          const xs: number[] = [];
          const ys: number[] = [];
          for (let row = 0; row < approximation.rows; row += 1) {
            xs.push(values[row * 2]);
            ys.push(values[row * 2 + 1]);
          }
          const box = {
            x0: Math.min(...xs) / canvas.width,
            y0: Math.min(...ys) / canvas.height,
            x1: Math.max(...xs) / canvas.width,
            y1: Math.max(...ys) / canvas.height,
          };
          const boxQuad = orderQuad([
            { x: box.x0, y: box.y0 },
            { x: box.x1, y: box.y0 },
            { x: box.x1, y: box.y1 },
            { x: box.x0, y: box.y1 },
          ]);
          candidates.push({ area, score: quadScore(boxQuad, fullArea, area) * 0.85, quad: boxQuad });
        }
      } finally {
        approximation?.delete();
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return candidates;
}

/** El cierre morfológico con kernel grande (min/8) a resolución completa tarda
    ~80 s por imagen en WASM (kernel de 100+ px = miles de millones de ops). El
    campo de iluminación varía suave, así que se estima a baja resolución y se
    re-escala: misma calidad, mil veces más rápido (técnica estándar de los
    estimadores de sombra: el iluminante se calcula pequeño, se aplica grande). */
const BG_FIELD_EDGE = 256;

function estimateBackground(cv: import('./opencv').OpenCv, gray: InstanceType<OpenCvMat>): InstanceType<OpenCvMat> {
  const minSide = Math.min(gray.cols, gray.rows);
  if (minSide <= BG_FIELD_EDGE) {
    const kernelSize = Math.max(15, Math.round(minSide / 8)) | 1;
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kernelSize, kernelSize));
    const background = new cv.Mat();
    try {
      cv.morphologyEx(gray, background, cv.MORPH_CLOSE, kernel);
    } finally {
      kernel.delete();
    }
    return background;
  }
  const scale = BG_FIELD_EDGE / minSide;
  const smallWidth = Math.max(2, Math.round(gray.cols * scale));
  const smallHeight = Math.max(2, Math.round(gray.rows * scale));
  const small = new cv.Mat();
  const smallBackground = new cv.Mat();
  const background = new cv.Mat();
  const smallKernelSize = Math.max(15, Math.round(Math.min(smallWidth, smallHeight) / 8)) | 1;
  const smallKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(smallKernelSize, smallKernelSize));
  try {
    cv.resize(gray, small, new cv.Size(smallWidth, smallHeight), 0, 0, cv.INTER_AREA);
    cv.morphologyEx(small, smallBackground, cv.MORPH_CLOSE, smallKernel);
    cv.resize(smallBackground, background, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_LINEAR);
  } finally {
    small.delete();
    smallBackground.delete();
    smallKernel.delete();
  }
  return background;
}

/** Gris con iluminación corregida: normaliza cada píxel por el fondo local
    (equivalente manual a CLAHE para hojas sombreadas; este build de opencv.js
    no incluye createCLAHE, pero morphologyEx + divide sí). */
function normalizeGray(cv: import('./opencv').OpenCv, source: HTMLCanvasElement): InstanceType<OpenCvMat> {
  const input = cv.imread(source);
  const gray = new cv.Mat();
  const normalized = new cv.Mat();
  try {
    cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY, 0);
    const estimated = estimateBackground(cv, gray);
    cv.divide(gray, estimated, normalized, 255, -1);
    estimated.delete();
  } finally {
    input.delete();
    gray.delete();
  }
  return normalized;
}

function edgePath(cv: import('./opencv').OpenCv, canvas: HTMLCanvasElement): QuadCandidate[] {
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  const normalized = normalizeGray(cv, canvas);
  try {
    cv.GaussianBlur(normalized, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 35, 95, 3, false);
    cv.dilate(edges, edges, kernel);
    return collectQuads(cv, edges, canvas);
  } finally {
    normalized.delete();
    blurred.delete();
    edges.delete();
    kernel.delete();
  }
}

function thresholdPath(cv: import('./opencv').OpenCv, canvas: HTMLCanvasElement): QuadCandidate[] {
  const source = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const binary = new cv.Mat();
  const closed = new cv.Mat();
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 51, 8);
    cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel);
    return collectQuads(cv, closed, canvas);
  } finally {
    source.delete();
    gray.delete();
    blurred.delete();
    binary.delete();
    closed.delete();
    kernel.delete();
  }
}

/** Un quad sirve solo si los cuatro lados son razonables y la figura es convexa. */
function quadValid(points: Quad): boolean {
  const sides = [0, 1, 2, 3].map((index) => distance(points[index], points[(index + 1) % 4]));
  const minSide = Math.min(...sides);
  const maxSide = Math.max(...sides);
  if (minSide <= 0 || minSide / maxSide < 0.2) return false;
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % 4];
    const after = points[(index + 2) % 4];
    const cross = (next.x - current.x) * (after.y - next.y) - (next.y - current.y) * (after.x - next.x);
    const normalized = Math.sign(cross);
    if (normalized === 0) return false;
    if (sign === 0) sign = normalized;
    else if (normalized !== sign) return false;
  }
  return true;
}

/** Ajusta cada esquina del quad a la esquina real más fuerte cercana (goodFeaturesToTrack).
    Si el build de OpenCV no trae la función, devuelve el quad sin tocar. */
function refineCorners(cv: import('./opencv').OpenCv, source: HTMLCanvasElement, quad: Quad): Quad {
  if (typeof cv.goodFeaturesToTrack !== 'function') return quad;
  const gray = normalizeGray(cv, source);
  const features = new cv.Mat();
  try {
    const radius = Math.max(22, Math.round(Math.min(source.width, source.height) * 0.055));
    const refined = quad.map((point) => {
      const cx = point.x * source.width;
      const cy = point.y * source.height;
      const x0 = Math.max(0, Math.round(cx - radius));
      const y0 = Math.max(0, Math.round(cy - radius));
      const width = Math.min(source.width - x0, radius * 2);
      const height = Math.min(source.height - y0, radius * 2);
      if (width < 8 || height < 8) return point;
      const roi = gray.roi(new cv.Rect(x0, y0, width, height));
      try {
        cv.goodFeaturesToTrack(roi, features, 12, 0.05, 4);
        let best: { x: number; y: number; dist: number } | null = null;
        for (let index = 0; index < features.rows; index += 1) {
          const fx = features.data32F[index * 2] + x0;
          const fy = features.data32F[index * 2 + 1] + y0;
          const dist = Math.hypot(fx - cx, fy - cy);
          if (dist > radius * 0.85) continue;
          if (!best || dist < best.dist) best = { x: fx, y: fy, dist };
        }
        if (!best) return point;
        return {
          x: Math.max(0, Math.min(1, best.x / source.width)),
          y: Math.max(0, Math.min(1, best.y / source.height)),
        };
      } finally {
        roi.delete();
      }
    }) as Quad;
    // Si el refinado rompió la geometría (características falsas sobre papel blanco),
    // conservamos el quad del contorno original.
    return quadValid(refined) ? refined : quad;
  } finally {
    gray.delete();
    features.delete();
  }
}

/** Detecta el cuadrilátero del documento sobre un canvas (usado por cámara en vivo y por capturas).
    Con corte de seguridad: si la detección tarda demasiado se abandona (mejor sin recorte que colgada). */
async function detectLegacyQuadFromCanvas(canvas: HTMLCanvasElement): Promise<Quad | null> {
  const work = (async () => {
    const cv = await getOpenCv();
    let all = [...edgePath(cv, canvas), ...thresholdPath(cv, canvas)];
    // Segunda pasada a media escala: hojas pequeñas o con bordes finos se ven mejor al reducir ruido.
    if (!all.length) {
      const half = document.createElement('canvas');
      half.width = Math.max(2, Math.round(canvas.width / 2));
      half.height = Math.max(2, Math.round(canvas.height / 2));
      half.getContext('2d', { willReadFrequently: true })!.drawImage(canvas, 0, 0, half.width, half.height);
      // Las coordenadas del quad son relativas (0..1): sirven igual a otra escala.
      all = [...edgePath(cv, half), ...thresholdPath(cv, half)];
    }
    all.sort((a, b) => b.score - a.score || b.area - a.area);
    const best = all[0];
    if (!best) return null;
    const refined = refineCorners(cv, canvas, best.quad);
    return quadValid(refined) ? refined : null;
  })();
  return Promise.race([
    work,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 25_000)),
  ]);
}

/** Detecta desde un Blob; null = no se encontró un documento claro (la revisión deja ajustar a mano). */
export async function detectDocumentQuad(input: Blob): Promise<Quad | null> {
  const canvas = await canvasFromBlob(input, DETECT_EDGE);
  return detectQuadFromCanvas(canvas);
}

export interface VideoCrop { x: number; y: number; width: number; height: number }

function canvasFromLiveVideo(video: HTMLVideoElement, crop?: VideoCrop | null) {
  if (!video.videoWidth) return null;
  const sx = (crop?.x ?? 0) * video.videoWidth;
  const sy = (crop?.y ?? 0) * video.videoHeight;
  const sw = (crop?.width ?? 1) * video.videoWidth;
  const sh = (crop?.height ?? 1) * video.videoHeight;
  const scale = Math.min(1, LIVE_DETECT_EDGE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(sw * scale));
  canvas.height = Math.max(2, Math.round(sh * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Detección liviana para el visor en vivo de la cámara. */
export async function detectLiveQuad(video: HTMLVideoElement): Promise<Quad | null> {
  const canvas = canvasFromLiveVideo(video);
  return canvas ? detectQuadFromCanvas(canvas) : null;
}

/** Métricas adicionales para que el autodisparo no confunda un borde débil con una hoja lista. */
export async function analyzeLiveQuad(video: HTMLVideoElement, crop?: VideoCrop | null) {
  const canvas = canvasFromLiveVideo(video, crop);
  return canvas ? analyzeQuadFromCanvas(canvas) : null;
}

async function enhanceCanvasFast(source: HTMLCanvasElement, filter: FilterMode) {
  if (filter === 'original') return source;
  const work = filter === 'bw' && Math.max(source.width, source.height) > 1500
    ? thumbnailFromCanvas(source, 1500)
    : source;
  const context = work.getContext('2d', { willReadFrequently: true })!;
  const input = context.getImageData(0, 0, work.width, work.height);
  context.putImageData(enhanceDocument(input, filter), 0, 0);
  return work;
}

async function renderProcessedCanvas(original: Blob, quad: Quad, rotation: Rotation, filter: FilterMode) {
  const source = await canvasFromBlob(original);
  let canvas = await warp(source, quad);
  canvas = rotateCanvas(canvas, rotation);
  return enhanceCanvasFast(canvas, filter);
}

function thumbnailFromCanvas(source: HTMLCanvasElement, maxEdge = 520) {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function renderProcessed(
  original: Blob,
  quad: Quad,
  rotation: Rotation,
  filter: FilterMode,
): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = await renderProcessedCanvas(original, quad, rotation, filter);
  return { blob: await canvasToBlob(canvas, 'image/jpeg', 0.93), width: canvas.width, height: canvas.height };
}

export async function makeThumbnail(blob: Blob): Promise<Blob> {
  const canvas = await canvasFromBlob(blob, 520);
  return canvasToBlob(canvas, 'image/jpeg', 0.82);
}

export interface ScanShot { blob: Blob; quad?: Quad; label?: string }

export async function createPage(shot: ScanShot, preset: FilterMode = 'original'): Promise<PageRecord> {
  const canvas = await canvasFromBlob(shot.blob, MAX_IMAGE_EDGE);
  const original = await canvasToBlob(canvas, 'image/jpeg', 0.95);
  const quad = shot.quad ?? FULL_QUAD.map((point) => ({ ...point })) as Quad;
  const processedCanvas = await renderProcessedCanvas(original, quad, 0, preset);
  const [processed, thumbnail] = await Promise.all([
    canvasToBlob(processedCanvas, 'image/jpeg', 0.93),
    canvasToBlob(thumbnailFromCanvas(processedCanvas), 'image/jpeg', 0.82),
  ]);
  return {
    id: newId(),
    original,
    processed,
    thumbnail,
    width: processedCanvas.width,
    height: processedCanvas.height,
    quad: quad.map((point) => ({ ...point })) as Quad,
    rotation: 0,
    filter: preset,
    label: shot.label,
    ocrText: '',
    createdAt: Date.now(),
  };
}

export async function reprocessPage(page: PageRecord): Promise<PageRecord> {
  const processedCanvas = await renderProcessedCanvas(page.original, page.quad, page.rotation, page.filter);
  const [processed, thumbnail] = await Promise.all([
    canvasToBlob(processedCanvas, 'image/jpeg', 0.93),
    canvasToBlob(thumbnailFromCanvas(processedCanvas), 'image/jpeg', 0.82),
  ]);
  return {
    ...page,
    processed,
    thumbnail,
    width: processedCanvas.width,
    height: processedCanvas.height,
  };
}

/** Divide un pliego de libro en dos páginas usando una línea central ajustable (0..1). */
export async function splitBookSpread(page: PageRecord, center: number): Promise<PageRecord[]> {
  const source = await canvasFromBlob(page.processed);
  const half = Math.round(source.width * Math.max(0.2, Math.min(0.8, center)));
  const halves = [[0, half], [half, source.width - half]] as const;
  const pages: PageRecord[] = [];
  for (const [offset, width] of halves) {
    if (width < 40) continue;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = source.height;
    canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, offset, 0, width, source.height, 0, 0, width, source.height);
    const processed = await canvasToBlob(canvas, 'image/jpeg', 0.94);
    pages.push({
      ...page,
      id: newId(),
      processed,
      thumbnail: await makeThumbnail(processed),
      width,
      height: source.height,
      createdAt: Date.now(),
    });
  }
  return pages.length ? pages : [{ ...page, id: newId(), createdAt: Date.now() }];
}

export async function rotatePage(page: PageRecord): Promise<PageRecord> {
  const rotation = ((page.rotation + 90) % 360) as Rotation;
  return reprocessPage({ ...page, rotation });
}
