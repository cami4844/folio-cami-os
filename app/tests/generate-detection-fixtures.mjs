import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '..', 'test-fixtures');
const scenes = [
  {
    name: 'deteccion-perspectiva',
    background: '#5b5044',
    paper: 'url(#paperGradient)',
    points: [[220, 105], [1020, 175], [920, 800], [125, 700]],
  },
  {
    name: 'deteccion-contraste-bajo',
    background: '#c7c1b5',
    paper: '#e9e5dc',
    points: [[145, 80], [1010, 120], [1080, 795], [200, 835]],
  },
  {
    name: 'deteccion-sombra-dura',
    background: '#60594f',
    paper: 'url(#shadowGradient)',
    points: [[170, 125], [1000, 75], [1090, 775], [235, 845]],
  },
];

const expectations = [];
for (const scene of scenes) {
  const polygon = scene.points.map((point) => point.join(',')).join(' ');
  const lines = Array.from({ length: 18 }, (_, index) => {
    const y = 275 + index * 25;
    const width = 560 - (index % 4) * 65;
    return `<rect x="285" y="${y}" width="${width}" height="7" rx="3" fill="#39352f" opacity="${index % 3 === 0 ? 0.82 : 0.5}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <defs>
      <linearGradient id="paperGradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffef8"/><stop offset="1" stop-color="#ded9cd"/></linearGradient>
      <linearGradient id="shadowGradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffef8"/><stop offset="0.52" stop-color="#f2eee5"/><stop offset="0.54" stop-color="#8d887f"/><stop offset="1" stop-color="#d4cfc5"/></linearGradient>
      <clipPath id="paperClip"><polygon points="${polygon}"/></clipPath>
    </defs>
    <rect width="1200" height="900" fill="${scene.background}"/>
    <path d="M0 210H1200M0 680H1200M110 0V900M1090 0V900" stroke="#ffffff" stroke-opacity=".08" stroke-width="4"/>
    <rect x="20" y="30" width="95" height="150" fill="#33302b" opacity=".55"/>
    <circle cx="1130" cy="80" r="75" fill="#2d2a26" opacity=".35"/>
    <polygon points="${polygon}" fill="#000" opacity=".28" transform="translate(14 16)"/>
    <polygon points="${polygon}" fill="${scene.paper}"/>
    <g clip-path="url(#paperClip)">
      <text x="285" y="220" font-family="Arial" font-size="52" font-weight="700" fill="#26231f">FOLIO</text>
      ${lines}
    </g>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(fixtures, `${scene.name}.png`));
  expectations.push({
    file: `${scene.name}.png`,
    width: 1200,
    height: 900,
    quad: scene.points.map(([x, y]) => ({ x: x / 1200, y: y / 900 })),
  });
}
expectations.push({
  file: 'documento-1.png',
  width: 1400,
  height: 1900,
  quad: [{ x: 110 / 1400, y: 90 / 1900 }, { x: 1290 / 1400, y: 90 / 1900 }, { x: 1290 / 1400, y: 1800 / 1900 }, { x: 110 / 1400, y: 1800 / 1900 }],
});
await writeFile(path.join(fixtures, 'detection-expectations.json'), JSON.stringify(expectations, null, 2));
console.log(`Generados ${expectations.length} casos de detección con esquinas conocidas`);
