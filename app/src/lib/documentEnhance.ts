import type { FilterMode } from '../types';

type IlluminationMap = {
  columns: number;
  rows: number;
  tile: number;
  luma: Float32Array;
};

const luminance = (red: number, green: number, blue: number) => red * 0.2126 + green * 0.7152 + blue * 0.0722;
const clampByte = (value: number) => Math.max(0, Math.min(255, value));

function smoothChannel(source: Float32Array, columns: number, rows: number): Float32Array {
  const target = new Float32Array(source.length);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = column + dx;
          const y = row + dy;
          if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
          const cellWeight = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          sum += source[y * columns + x] * cellWeight;
          weight += cellWeight;
        }
      }
      target[row * columns + column] = sum / weight;
    }
  }
  return target;
}

function buildIlluminationMap(image: ImageData): IlluminationMap {
  const { width, height, data } = image;
  const tile = Math.max(28, Math.round(Math.min(width, height) / 30));
  const columns = Math.max(2, Math.ceil(width / tile));
  const rows = Math.max(2, Math.ceil(height / tile));
  const cells = columns * rows;
  const map: IlluminationMap = {
    columns,
    rows,
    tile,
    luma: new Float32Array(cells),
  };

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = column * tile;
      const y0 = row * tile;
      const x1 = Math.min(width, x0 + tile);
      const y1 = Math.min(height, y0 + tile);
      const stride = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 18));
      const samples: number[] = [];
      for (let y = y0; y < y1; y += stride) {
        for (let x = x0; x < x1; x += stride) {
          const offset = (y * width + x) * 4;
          samples.push(luminance(data[offset], data[offset + 1], data[offset + 2]));
        }
      }
      samples.sort((a, b) => a - b);
      const paperLevel = samples.length ? samples[Math.floor((samples.length - 1) * 0.72)] : 235;
      let lumaSum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += stride) {
        for (let x = x0; x < x1; x += stride) {
          const offset = (y * width + x) * 4;
          const luma = luminance(data[offset], data[offset + 1], data[offset + 2]);
          if (luma < paperLevel) continue;
          lumaSum += luma;
          count += 1;
        }
      }
      const index = row * columns + column;
      map.luma[index] = count ? lumaSum / count : 235;
    }
  }

  map.luma = smoothChannel(map.luma, columns, rows);
  return map;
}

function sampleMap(channel: Float32Array, map: IlluminationMap, x: number, y: number): number {
  const gx = Math.max(0, Math.min(map.columns - 1, (x + 0.5) / map.tile - 0.5));
  const gy = Math.max(0, Math.min(map.rows - 1, (y + 0.5) / map.tile - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(map.columns - 1, x0 + 1);
  const y1 = Math.min(map.rows - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const top = channel[y0 * map.columns + x0] * (1 - tx) + channel[y0 * map.columns + x1] * tx;
  const bottom = channel[y1 * map.columns + x0] * (1 - tx) + channel[y1 * map.columns + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function toneChannel(value: number, luma: number): number {
  const inkProtection = luma < 145 ? 0.88 + (luma / 145) * 0.12 : 1;
  const paperLift = luma > 180 ? Math.min(0.3, ((luma - 180) / 75) * 0.3) : 0;
  const toned = value * inkProtection;
  return clampByte(toned + (255 - toned) * paperLift);
}

function bilevel(normalized: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const pixels = width * height;
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  const squares = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    let rowSquares = 0;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = normalized[index];
      rowSum += value;
      rowSquares += value * value;
      const position = (y + 1) * stride + x + 1;
      const above = y * stride + x + 1;
      sums[position] = sums[above] + rowSum;
      squares[position] = squares[above] + rowSquares;
    }
  }
  const output = new Uint8ClampedArray(pixels);
  const window = Math.max(15, Math.round(Math.min(width, height) / 48) | 1);
  const half = window >> 1;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height - 1, y + half);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width - 1, x + half);
      const topLeft = y0 * stride + x0;
      const topRight = y0 * stride + x1 + 1;
      const bottomLeft = (y1 + 1) * stride + x0;
      const bottomRight = (y1 + 1) * stride + x1 + 1;
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = sums[bottomRight] - sums[bottomLeft] - sums[topRight] + sums[topLeft];
      const squareSum = squares[bottomRight] - squares[bottomLeft] - squares[topRight] + squares[topLeft];
      const mean = sum / count;
      const deviation = Math.sqrt(Math.max(0, squareSum / count - mean * mean));
      const threshold = mean * (1 + 0.2 * (deviation / 128 - 1));
      output[y * width + x] = normalized[y * width + x] < threshold ? 0 : 255;
    }
  }
  return output;
}

export function enhanceDocument(image: ImageData, mode: FilterMode): ImageData {
  if (mode === 'original') return image;
  const { width, height, data } = image;
  const map = buildIlluminationMap(image);
  const normalized = new Uint8ClampedArray(width * height);
  const output = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const backgroundLuma = Math.max(36, sampleMap(map.luma, map, x, y));
      const lumaGain = Math.max(0.72, Math.min(1.7, 242 / backgroundLuma));
      const currentLuma = luminance(data[offset], data[offset + 1], data[offset + 2]);
      normalized[pixel] = clampByte(currentLuma * lumaGain);
      if (mode === 'bw') continue;

      if (mode === 'gray') {
        const gray = toneChannel(normalized[pixel], normalized[pixel]);
        output[offset] = gray;
        output[offset + 1] = gray;
        output[offset + 2] = gray;
        continue;
      }

      const normalizedLuma = normalized[pixel];
      output[offset] = toneChannel(data[offset] * lumaGain, normalizedLuma);
      output[offset + 1] = toneChannel(data[offset + 1] * lumaGain, normalizedLuma);
      output[offset + 2] = toneChannel(data[offset + 2] * lumaGain, normalizedLuma);
    }
  }

  if (mode === 'bw') {
    const binary = bilevel(normalized, width, height);
    for (let pixel = 0; pixel < binary.length; pixel += 1) {
      const offset = pixel * 4;
      output[offset] = binary[pixel];
      output[offset + 1] = binary[pixel];
      output[offset + 2] = binary[pixel];
    }
  }

  return new ImageData(output, width, height);
}
