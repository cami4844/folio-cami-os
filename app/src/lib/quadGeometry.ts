import type { Quad } from '../types';

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export function quadGeometryError(points: Quad, minArea = 0.0005, minSide = 0.004): string | null {
  if (points.length !== 4 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return 'El contorno necesita cuatro coordenadas válidas.';
  }
  if (points.some((point, index) => distance(point, points[(index + 1) % 4]) < minSide)) {
    return 'Dos esquinas quedaron demasiado juntas. Sepáralas para formar la hoja.';
  }
  let twiceArea = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const turn = cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y);
    if (turn <= 1e-8) return 'El contorno está cruzado o doblado sobre sí mismo. Ordena las esquinas alrededor de la hoja.';
    twiceArea += cross(a.x, a.y, b.x, b.y);
  }
  if (twiceArea <= 0) return 'La orientación del contorno no coincide con la salida del documento.';
  if (twiceArea / 2 < minArea) return 'El área seleccionada es demasiado pequeña para crear una página.';
  return null;
}

export function validateUsableQuad(points: Quad, minArea = 0.0005, minSide = 0.004): boolean {
  return quadGeometryError(points, minArea, minSide) === null;
}

export function projectToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-8) return 0.5;
  return ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
}
