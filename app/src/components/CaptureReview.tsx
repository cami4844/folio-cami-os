import { useEffect, useState } from 'react';
import { Check, RotateCcw, ScanLine, X } from 'lucide-react';
import type { Quad } from '../types';
import { detectQuadFromCanvas, canvasFromBlob } from '../lib/image';
import { projectToSegment, quadGeometryError } from '../lib/quadGeometry';
import { useBlobUrl } from './BlobImage';
import QuadEditor from './QuadEditor';

interface Props {
  blob: Blob;
  initialQuad: Quad | null;
  busy: boolean;
  variant: 'scan' | 'card' | 'book';
  confirmLabel: string;
  onConfirm: (quad: Quad, splitCenter: number | null) => void;
  onRetake: () => void;
}

const FALLBACK_QUAD: Quad = [
  { x: 0.02, y: 0.02 }, { x: 0.98, y: 0.02 }, { x: 0.98, y: 0.98 }, { x: 0.02, y: 0.98 },
];

export default function CaptureReview({ blob, initialQuad, busy, variant, confirmLabel, onConfirm, onRetake }: Props) {
  const url = useBlobUrl(blob);
  const [quad, setQuad] = useState<Quad>(initialQuad ?? FALLBACK_QUAD.map((point) => ({ ...point })) as Quad);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(initialQuad !== null);
  const [center, setCenter] = useState(0.5);
  const [split, setSplit] = useState(true);
  const [centerDragging, setCenterDragging] = useState(false);
  const [geometryError, setGeometryError] = useState('');

  useEffect(() => {
    setQuad(initialQuad ?? FALLBACK_QUAD.map((point) => ({ ...point })) as Quad);
    setDetected(initialQuad !== null);
    setDetecting(false);
    setCenter(0.5);
    setSplit(true);
    setGeometryError('');
  }, [blob, initialQuad]);

  useEffect(() => {
    let cancelled = false;
    if (initialQuad) return;
    setDetecting(true);
    (async () => {
      try {
        const canvas = await canvasFromBlob(blob, 720);
        const found = await detectQuadFromCanvas(canvas);
        if (!cancelled && found) {
          setQuad(found);
          setDetected(true);
        }
      } catch {
        // La edición manual siempre queda disponible sobre la foto completa.
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [blob, initialQuad]);

  const redetect = async () => {
    setDetecting(true);
    try {
      const canvas = await canvasFromBlob(blob, 720);
      const found = await detectQuadFromCanvas(canvas);
      if (found) {
        setQuad(found);
        setDetected(true);
      }
      setGeometryError('');
    } catch {
      setGeometryError('No pudimos detectar los bordes esta vez. El contorno actual sigue editable.');
    } finally {
      setDetecting(false);
    }
  };

  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const bookTop = lerp(quad[0], quad[1], center);
  const bookBottom = lerp(quad[3], quad[2], center);
  const bookMiddle = lerp(bookTop, bookBottom, 0.5);
  const bookLeft = lerp(quad[0], quad[3], 0.5);
  const bookRight = lerp(quad[1], quad[2], 0.5);

  return (
    <div className="capture-review">
      <div className="review-stage">
        {url ? (
          <QuadEditor src={url} quad={quad} onChange={(next) => { setGeometryError(''); setQuad(next); }} disabled={busy || detecting} fit="contain" label="Revisar los bordes de la captura">
            {variant === 'card' && <div className="id-guide review-guide" aria-hidden="true" />}
            {variant === 'book' && split && (
              <>
                <svg className="book-split-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <line x1={bookTop.x * 100} y1={bookTop.y * 100} x2={bookBottom.x * 100} y2={bookBottom.y * 100} />
                </svg>
                <button
                  type="button"
                  className="book-center-handle"
                  style={{ left: `${bookMiddle.x * 100}%`, top: `${bookMiddle.y * 100}%` }}
                  aria-label="Mover división central del libro"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setCenterDragging(true);
                  }}
                  onPointerMove={(event) => {
                    if (!centerDragging) return;
                    const editor = event.currentTarget.parentElement;
                    if (!editor) return;
                    const rect = editor.getBoundingClientRect();
                    const projected = projectToSegment(
                      { x: event.clientX - rect.left, y: event.clientY - rect.top },
                      { x: bookLeft.x * rect.width, y: bookLeft.y * rect.height },
                      { x: bookRight.x * rect.width, y: bookRight.y * rect.height },
                    );
                    setCenter(Math.max(0.2, Math.min(0.8, projected)));
                  }}
                  onPointerUp={() => setCenterDragging(false)}
                  onPointerCancel={() => setCenterDragging(false)}
                ><span /></button>
              </>
            )}
            {(detecting || busy) && (
              <div className="processing-cover"><span className="spinner" /><strong>{detecting ? 'Buscando los bordes…' : 'Procesando…'}</strong></div>
            )}
          </QuadEditor>
        ) : (
          <div className="review-loading"><span className="spinner" /> Abriendo captura…</div>
        )}
      </div>

      <div className="review-status">
        {detected && !detecting
          ? 'Este es el mismo contorno de la captura. Puedes mover cada punto por toda la foto.'
          : 'Ajusta los 4 puntos sobre cualquier zona de la foto original.'}
      </div>

      {variant === 'book' && (
        <label className="book-split-row">
          <input type="checkbox" checked={split} onChange={(event) => setSplit(event.target.checked)} />
          <span>Dividir en dos páginas</span>
          <input
            type="range"
            min={0.2}
            max={0.8}
            step={0.01}
            value={center}
            disabled={!split}
            onChange={(event) => setCenter(Number(event.target.value))}
            aria-label="Línea central del libro"
          />
        </label>
      )}

      {geometryError && <p className="geometry-error" role="alert">{geometryError}</p>}

      <div className="review-actions">
        <button className="button secondary" onClick={onRetake} disabled={busy}><RotateCcw /> Volver a tomar</button>
        <button className="button ghost" onClick={() => void redetect()} disabled={detecting || busy}><ScanLine /> Detectar de nuevo</button>
        <button className="button primary" onClick={() => {
          const issue = quadGeometryError(quad);
          if (issue) { setGeometryError(issue); return; }
          onConfirm(quad, variant === 'book' && split ? center : null);
        }} disabled={detecting || busy || !url}><Check /> {confirmLabel}</button>
        <button className="review-discard" onClick={onRetake} disabled={busy} aria-label="Descartar captura"><X /></button>
      </div>
    </div>
  );
}
