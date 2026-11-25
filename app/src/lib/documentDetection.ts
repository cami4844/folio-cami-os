import type { Quad } from '../types';
import { getOpenCv } from './opencv';
import { validateUsableQuad } from './quadGeometry';

type Cv = import('./opencv').OpenCv;
type Mat = InstanceType<Cv['Mat']>;
type Point = { x: number; y: number };

export interface DocumentDetection {
  quad: Quad;
  confidence: number;
  coverage: number;
  sideSupport: number;
  sharpness: number;
  brightness: number;
}

interface Candidate {
  quad: Quad;
  areaRatio: number;
  sideSupport: number;
  score: number;
}

interface Segment {
  a: Point;
  b: Point;
  length: number;
  horizontal: boolean;
}

const MIN_AREA_RATIO = 0.055;
const EPSILONS = [0.01, 0.02, 0.03, 0.04, 0.06, 0.08];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function orderQuad(points: Point[]): Quad {
  if (points.length !== 4) throw new Error('Se necesitan cuatro esquinas');
  const bySum = [...points].sort((a, b) => a.x + a.y - b.x - b.y);
  const byDifference = [...points].sort((a, b) => a.x - a.y - (b.x - b.y));
  const topLeft = bySum[0];
  const bottomRight = bySum[3];
  const bottomLeft = byDifference[0];
  const topRight = byDifference[3];
  if (new Set([topLeft, topRight, bottomRight, bottomLeft]).size === 4) {
    return [topLeft, topRight, bottomRight, bottomLeft];
  }
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const startPoint = [...points].sort((a, b) => a.y - b.y || a.x - b.x)[0];
  const start = sorted.indexOf(startPoint);
  const rotated = [...sorted.slice(start), ...sorted.slice(0, start)];
  const quad = rotated as Quad;
  const cross = (quad[1].x - quad[0].x) * (quad[2].y - quad[1].y) - (quad[1].y - quad[0].y) * (quad[2].x - quad[1].x);
  return cross < 0 ? [quad[0], quad[3], quad[2], quad[1]] : quad;
}

function areaOf(points: Point[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(area) / 2;
}

function cornerAngle(a: Point, vertex: Point, b: Point) {
  const first = { x: a.x - vertex.x, y: a.y - vertex.y };
  const second = { x: b.x - vertex.x, y: b.y - vertex.y };
  const denominator = Math.max(1e-8, Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y));
  return Math.acos(Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / denominator))) * 180 / Math.PI;
}

function validQuad(points: Quad, areaRatio: number) {
  if (areaRatio < MIN_AREA_RATIO || areaRatio > 1.04) return false;
  const sides = points.map((point, index) => distance(point, points[(index + 1) % 4]));
  if (Math.min(...sides) / Math.max(...sides) < 0.16) return false;
  const angles = points.map((point, index) => cornerAngle(points[(index + 3) % 4], point, points[(index + 1) % 4]));
  if (Math.min(...angles) < 24 || Math.max(...angles) > 156) return false;
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-7) return false;
    const current = Math.sign(cross);
    if (sign && current !== sign) return false;
    sign = current;
  }
  return sign > 0;
}

function absCosine(a: Point, b: Point) {
  return Math.abs((a.x * b.x + a.y * b.y) / Math.max(1e-8, Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)));
}

function geometryScore(points: Quad) {
  const horizontalParallel = absCosine(
    { x: points[1].x - points[0].x, y: points[1].y - points[0].y },
    { x: points[2].x - points[3].x, y: points[2].y - points[3].y },
  );
  const verticalParallel = absCosine(
    { x: points[3].x - points[0].x, y: points[3].y - points[0].y },
    { x: points[2].x - points[1].x, y: points[2].y - points[1].y },
  );
  const top = distance(points[0], points[1]);
  const bottom = distance(points[3], points[2]);
  const left = distance(points[0], points[3]);
  const right = distance(points[1], points[2]);
  const balance = (Math.min(top, bottom) / Math.max(top, bottom) + Math.min(left, right) / Math.max(left, right)) / 2;
  const angles = points.map((point, index) => cornerAngle(points[(index + 3) % 4], point, points[(index + 1) % 4]));
  const angleScore = angles.reduce((sum, angle) => sum + clamp01(1 - Math.abs(angle - 90) / 90), 0) / 4;
  return horizontalParallel * 0.22 + verticalParallel * 0.22 + balance * 0.30 + angleScore * 0.26;
}

/** Porcentaje de muestras de los cuatro lados que tienen un borde real cerca. */
function sideSupport(binary: Mat, points: Quad) {
  const data = binary.data;
  const radius = 2;
  let supported = 0;
  let samples = 0;
  for (let side = 0; side < 4; side += 1) {
    const a = points[side];
    const b = points[(side + 1) % 4];
    for (let step = 2; step < 22; step += 1) {
      const t = step / 23;
      const x = Math.round((a.x + (b.x - a.x) * t) * (binary.cols - 1));
      const y = Math.round((a.y + (b.y - a.y) * t) * (binary.rows - 1));
      let found = false;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(binary.rows - 1, y + radius) && !found; yy += 1) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(binary.cols - 1, x + radius); xx += 1) {
          if (data[yy * binary.cols + xx] > 0) {
            found = true;
            break;
          }
        }
      }
      if (found) supported += 1;
      samples += 1;
    }
  }
  return supported / Math.max(1, samples);
}

function normalizePoints(points: Point[], width: number, height: number): Point[] {
  return points.map((point) => ({
    x: Math.max(0, Math.min(1, point.x / width)),
    y: Math.max(0, Math.min(1, point.y / height)),
  }));
}

function rotatedRectPoints(rect: { center: Point; size: { width: number; height: number }; angle: number }) {
  const angle = rect.angle * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const halfWidth = rect.size.width / 2;
  const halfHeight = rect.size.height / 2;
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((point) => ({
    x: rect.center.x + point.x * cosine - point.y * sine,
    y: rect.center.y + point.x * sine + point.y * cosine,
  }));
}

function extremePoints(contour: Mat): Point[] {
  const values = contour.data32S;
  let topLeft = { x: values[0], y: values[1], sum: values[0] + values[1] };
  let bottomRight = { ...topLeft };
  let topRight = { x: values[0], y: values[1], difference: values[0] - values[1] };
  let bottomLeft = { ...topRight };
  for (let index = 1; index < contour.rows; index += 1) {
    const x = values[index * 2];
    const y = values[index * 2 + 1];
    const sum = x + y;
    const difference = x - y;
    if (sum < topLeft.sum) topLeft = { x, y, sum };
    if (sum > bottomRight.sum) bottomRight = { x, y, sum };
    if (difference > topRight.difference) topRight = { x, y, difference };
    if (difference < bottomLeft.difference) bottomLeft = { x, y, difference };
  }
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function collectQuads(cv: Cv, binary: Mat, width: number, height: number): Candidate[] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const fullArea = width * height;
  const contenders: { contour: Mat; area: number }[] = [];

  const add = (rawPoints: Point[], contourArea: number, penalty = 1) => {
    let ordered: Quad;
    try {
      ordered = orderQuad(rawPoints);
    } catch {
      return;
    }
    const areaRatio = areaOf(ordered) / fullArea;
    if (!validQuad(ordered, areaRatio)) return;
    const quad = normalizePoints(ordered, width, height) as Quad;
    if (!validateUsableQuad(quad)) return;
    const key = quad.map((point) => `${Math.round(point.x * 80)},${Math.round(point.y * 80)}`).join(':');
    if (seen.has(key)) return;
    seen.add(key);
    const support = sideSupport(binary, quad);
    const rectangularity = clamp01(contourArea / Math.max(1, areaRatio * fullArea));
    const coverage = clamp01((areaRatio - MIN_AREA_RATIO) / 0.48);
    const borderPenalty = areaRatio > 0.975 ? 0.91 : 1;
    const score = (coverage * 0.32 + support * 0.35 + geometryScore(ordered) * 0.23 + rectangularity * 0.10) * penalty * borderPenalty;
    candidates.push({ quad, areaRatio, sideSupport: support, score });
  };

  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const area = cv.contourArea(contour, false);
      if (area >= fullArea * MIN_AREA_RATIO) contenders.push({ contour, area });
      else contour.delete();
    }
    contenders.sort((a, b) => b.area - a.area);
    for (const item of contenders.slice(30)) item.contour.delete();
    for (const { contour, area } of contenders.slice(0, 30)) {
      const hull = new cv.Mat();
      try {
        cv.convexHull(contour, hull, false, true);
        if (hull.rows >= 4) {
          // jscanify: los extremos por cuadrantes recuperan una hoja aunque su
          // contorno tenga más de cuatro vértices o una esquina doblada.
          add(extremePoints(hull), area, 0.94);
          const rect = cv.minAreaRect(hull);
          add(rotatedRectPoints(rect), area, 0.94);
        }
        const perimeter = cv.arcLength(hull, true);
        for (const epsilon of EPSILONS) {
          const approximation = new cv.Mat();
          try {
            cv.approxPolyDP(hull, approximation, perimeter * epsilon, true);
            if (approximation.rows === 4) {
              const values = approximation.data32S;
              add(Array.from({ length: 4 }, (_, point) => ({ x: values[point * 2], y: values[point * 2 + 1] })), area);
              break;
            }
          } finally {
            approximation.delete();
          }
        }
      } finally {
        hull.delete();
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return candidates;
}

function cannyCandidates(cv: Cv, gray: Mat, width: number, height: number, low: number, high: number, closeText: boolean) {
  const prepared = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const joined = new cv.Mat();
  const textKernel = cv.Mat.ones(5, 5, cv.CV_8U);
  const edgeKernel = cv.Mat.ones(3, 3, cv.CV_8U);
  try {
    if (closeText) cv.morphologyEx(gray, prepared, cv.MORPH_CLOSE, textKernel);
    else gray.copyTo(prepared);
    cv.GaussianBlur(prepared, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, low, high, 3, false);
    cv.morphologyEx(edges, joined, cv.MORPH_CLOSE, edgeKernel);
    return { candidates: collectQuads(cv, joined, width, height), edges: joined };
  } finally {
    prepared.delete();
    blurred.delete();
    edges.delete();
    textKernel.delete();
    edgeKernel.delete();
  }
}

function otsuCandidates(cv: Cv, gray: Mat, width: number, height: number, inverse: boolean) {
  const blurred = new cv.Mat();
  const binary = new cv.Mat();
  const closed = new cv.Mat();
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  try {
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.threshold(blurred, binary, 0, 255, (inverse ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY) + cv.THRESH_OTSU);
    cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel);
    return collectQuads(cv, closed, width, height);
  } finally {
    blurred.delete();
    binary.delete();
    closed.delete();
    kernel.delete();
  }
}

function intersection(a: Segment, b: Segment): Point | null {
  const x1 = a.a.x;
  const y1 = a.a.y;
  const x2 = a.b.x;
  const y2 = a.b.y;
  const x3 = b.a.x;
  const y3 = b.a.y;
  const x4 = b.b.x;
  const y4 = b.b.y;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < 1e-5) return null;
  const first = x1 * y2 - y1 * x2;
  const second = x3 * y4 - y3 * x4;
  return {
    x: (first * (x3 - x4) - (x1 - x2) * second) / denominator,
    y: (first * (y3 - y4) - (y1 - y2) * second) / denominator,
  };
}

/** Reconstruye los lados desde segmentos cuando el contorno de la hoja está roto. */
function lineCandidates(cv: Cv, edges: Mat, width: number, height: number): Candidate[] {
  const lines = new cv.Mat();
  const candidates: Candidate[] = [];
  try {
    const shortSide = Math.min(width, height);
    cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 24, Math.max(28, shortSide * 0.16), Math.max(6, shortSide * 0.045));
    const segments: Segment[] = [];
    for (let index = 0; index < lines.rows; index += 1) {
      const a = { x: lines.data32S[index * 4], y: lines.data32S[index * 4 + 1] };
      const b = { x: lines.data32S[index * 4 + 2], y: lines.data32S[index * 4 + 3] };
      const length = distance(a, b);
      const rawAngle = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
      const angle = Math.min(rawAngle, 180 - rawAngle);
      if (angle <= 38) segments.push({ a, b, length, horizontal: true });
      else if (angle >= 52) segments.push({ a, b, length, horizontal: false });
    }
    const horizontal = segments.filter((line) => line.horizontal).sort((a, b) => b.length - a.length).slice(0, 7);
    const vertical = segments.filter((line) => !line.horizontal).sort((a, b) => b.length - a.length).slice(0, 7);
    const add = (points: Point[]) => {
      let ordered: Quad;
      try {
        ordered = orderQuad(points);
      } catch {
        return;
      }
      const areaRatio = areaOf(ordered) / (width * height);
      if (!validQuad(ordered, areaRatio)) return;
      const quad = normalizePoints(ordered, width, height) as Quad;
      if (!validateUsableQuad(quad)) return;
      const support = sideSupport(edges, quad);
      if (support < 0.34) return;
      const coverage = clamp01((areaRatio - MIN_AREA_RATIO) / 0.48);
      const score = (coverage * 0.27 + support * 0.43 + geometryScore(ordered) * 0.30) * 0.96;
      candidates.push({ quad, areaRatio, sideSupport: support, score });
    };
    for (let first = 0; first < horizontal.length; first += 1) {
      for (let second = first + 1; second < horizontal.length; second += 1) {
        const top = horizontal[first];
        const bottom = horizontal[second];
        if (Math.abs((top.a.y + top.b.y - bottom.a.y - bottom.b.y) / 2) < height * 0.14) continue;
        for (let leftIndex = 0; leftIndex < vertical.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < vertical.length; rightIndex += 1) {
            const left = vertical[leftIndex];
            const right = vertical[rightIndex];
            if (Math.abs((left.a.x + left.b.x - right.a.x - right.b.x) / 2) < width * 0.14) continue;
            const corners = [intersection(top, left), intersection(top, right), intersection(bottom, right), intersection(bottom, left)];
            if (corners.some((point) => !point || point.x < -width * 0.06 || point.x > width * 1.06 || point.y < -height * 0.06 || point.y > height * 1.06)) continue;
            add(corners as Point[]);
          }
        }
      }
    }
  } finally {
    lines.delete();
  }
  return candidates;
}

function runDetection(cv: Cv, gray: Mat, width: number, height: number) {
  const original = cannyCandidates(cv, gray, width, height, 18, 55, false);
  const closedText = cannyCandidates(cv, gray, width, height, 15, 45, true);
  const stronger = cannyCandidates(cv, gray, width, height, 45, 135, false);
  const candidates = [
    ...original.candidates,
    ...closedText.candidates,
    ...stronger.candidates,
    ...otsuCandidates(cv, gray, width, height, false),
    ...otsuCandidates(cv, gray, width, height, true),
  ];
  stronger.edges.delete();
  closedText.edges.delete();
  return { candidates, recoveryEdges: original.edges };
}

function frameMetrics(cv: Cv, gray: Mat) {
  const mean = new cv.Mat();
  const deviation = new cv.Mat();
  const laplacian = new cv.Mat();
  const lapMean = new cv.Mat();
  const lapDeviation = new cv.Mat();
  try {
    cv.meanStdDev(gray, mean, deviation);
    cv.Laplacian(gray, laplacian, cv.CV_64F);
    cv.meanStdDev(laplacian, lapMean, lapDeviation);
    return {
      brightness: mean.data64F[0],
      sharpness: lapDeviation.data64F[0] ** 2,
    };
  } finally {
    mean.delete();
    deviation.delete();
    laplacian.delete();
    lapMean.delete();
    lapDeviation.delete();
  }
}

export async function analyzeQuadFromCanvas(canvas: HTMLCanvasElement): Promise<DocumentDetection | null> {
  const cv = await getOpenCv();
  const input = cv.imread(canvas);
  const gray = new cv.Mat();
  let recoveryEdges: Mat | undefined;
  try {
    cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY, 0);
    const metrics = frameMetrics(cv, gray);
    let result = runDetection(cv, gray, canvas.width, canvas.height);
    recoveryEdges = result.recoveryEdges;
    let candidates = result.candidates;
    let best = candidates.sort((a, b) => b.score - a.score)[0];

    if ((!best || best.score < 0.48) && Math.min(canvas.width, canvas.height) > 300) {
      const half = document.createElement('canvas');
      half.width = Math.round(canvas.width / 2);
      half.height = Math.round(canvas.height / 2);
      half.getContext('2d', { willReadFrequently: true })!.drawImage(canvas, 0, 0, half.width, half.height);
      const smallInput = cv.imread(half);
      const smallGray = new cv.Mat();
      try {
        cv.cvtColor(smallInput, smallGray, cv.COLOR_RGBA2GRAY, 0);
        const retry = runDetection(cv, smallGray, half.width, half.height);
        candidates = [...candidates, ...retry.candidates];
        retry.recoveryEdges.delete();
      } finally {
        smallInput.delete();
        smallGray.delete();
      }
    }

    best = candidates.sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 0.46) {
      candidates.push(...lineCandidates(cv, recoveryEdges, canvas.width, canvas.height));
      best = candidates.sort((a, b) => b.score - a.score)[0];
    }
    if (!best || best.score < 0.36) return null;
    return {
      quad: best.quad,
      confidence: clamp01(best.score),
      coverage: best.areaRatio,
      sideSupport: best.sideSupport,
      ...metrics,
    };
  } finally {
    recoveryEdges?.delete();
    input.delete();
    gray.delete();
  }
}

export async function detectQuadFromCanvas(canvas: HTMLCanvasElement): Promise<Quad | null> {
  const result = await analyzeQuadFromCanvas(canvas);
  return result?.quad ?? null;
}
