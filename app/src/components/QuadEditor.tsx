import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Quad } from '../types';

interface Props {
  src: string;
  quad: Quad;
  onChange: (quad: Quad) => void;
  onDraggingChange?: (dragging: boolean) => void;
  disabled?: boolean;
  label?: string;
  fit?: 'width' | 'contain';
  children?: ReactNode;
}

const cornerNames = ['superior izquierda', 'superior derecha', 'inferior derecha', 'inferior izquierda'];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export default function QuadEditor({ src, quad, onChange, onDraggingChange, disabled = false, label = 'Ajustar esquinas del documento', fit = 'width', children }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<{ index: number; pointerId: number } | null>(null);
  const [activeCorner, setActiveCorner] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 });
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (fit !== 'contain' || !stage.current?.parentElement) return;
    const parent = stage.current.parentElement;
    const resize = () => {
      const scale = Math.min(parent.clientWidth / naturalSize.width, parent.clientHeight / naturalSize.height);
      if (!Number.isFinite(scale) || scale <= 0) return;
      setFitSize({ width: Math.max(1, Math.floor(naturalSize.width * scale)), height: Math.max(1, Math.floor(naturalSize.height * scale)) });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    return () => observer.disconnect();
  }, [fit, naturalSize, src]);

  const moveCorner = (index: number, x: number, y: number) => {
    onChange(quad.map((point, pointIndex) => pointIndex === index ? { x: clamp(x), y: clamp(y) } : point) as Quad);
  };

  useEffect(() => {
    if (activeCorner === null || !loupe.current || !image.current || !stage.current) return;
    const canvas = loupe.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    const rect = stage.current.getBoundingClientRect();
    const point = quad[activeCorner];
    const scale = naturalSize.width / Math.max(1, rect.width);
    const sourceSize = Math.max(12, 38 * scale);
    const centerX = point.x * naturalSize.width;
    const centerY = point.y * naturalSize.height;
    const sx = Math.max(0, Math.min(naturalSize.width - sourceSize, centerX - sourceSize / 2));
    const sy = Math.max(0, Math.min(naturalSize.height - sourceSize, centerY - sourceSize / 2));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image.current, sx, sy, sourceSize, sourceSize, 0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#ffc93c';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(canvas.width / 2, 8);
    context.lineTo(canvas.width / 2, canvas.height - 8);
    context.moveTo(8, canvas.height / 2);
    context.lineTo(canvas.width - 8, canvas.height / 2);
    context.stroke();
  }, [activeCorner, naturalSize, quad]);

  return (
    <div
      className={`quad-editor${fit === 'contain' ? ' fit-contain' : ''}`}
      ref={stage}
      style={fit === 'contain' && fitSize ? fitSize : undefined}
      role="group"
      aria-label={label}
      onPointerMove={(event) => {
        const current = dragging.current;
        if (!current || current.pointerId !== event.pointerId || !stage.current) return;
        event.preventDefault();
        const rect = stage.current.getBoundingClientRect();
        moveCorner(current.index, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      }}
      onPointerUp={(event) => {
        if (dragging.current?.pointerId !== event.pointerId) return;
        dragging.current = null;
        setActiveCorner(null);
        onDraggingChange?.(false);
      }}
      onPointerCancel={() => {
        dragging.current = null;
        setActiveCorner(null);
        onDraggingChange?.(false);
      }}
    >
      <img
        ref={image}
        src={src}
        alt="Documento original para ajustar sus cuatro esquinas"
        draggable={false}
        onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      />
      <svg className="quad-editor-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={quad.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')} />
      </svg>
      {quad.map((point, index) => (
        <button
          type="button"
          key={index}
          className={`quad-handle${activeCorner === index ? ' active' : ''}`}
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          aria-label={`Mover esquina ${cornerNames[index]}`}
          aria-pressed={activeCorner === index}
          disabled={disabled}
          onPointerDown={(event) => {
            if (disabled) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragging.current = { index, pointerId: event.pointerId };
            setActiveCorner(index);
            onDraggingChange?.(true);
          }}
          onKeyDown={(event) => {
            const directions: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
            };
            const direction = directions[event.key];
            if (!direction) return;
            event.preventDefault();
            const step = event.shiftKey ? 0.02 : 0.004;
            moveCorner(index, point.x + direction[0] * step, point.y + direction[1] * step);
          }}
        >
          <span />
        </button>
      ))}
      {children}
      {activeCorner !== null && (
        <canvas
          ref={loupe}
          className={`quad-loupe${quad[activeCorner].x > 0.56 ? ' left' : ''}${quad[activeCorner].y > 0.56 ? ' top' : ''}`}
          width={152}
          height={152}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
