import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, Share2, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { FolioDocument } from '../types';
import { pushBackHandler } from '../lib/backStack';
import { rotatePage } from '../lib/image';
import { saveOrShare } from '../lib/files';
import BlobImage from './BlobImage';

interface Props {
  document: FolioDocument;
  pageId: string;
  busy: boolean;
  onChange: (document: FolioDocument) => void;
  onNavigate: (pageId: string) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}

export default function PageViewer({ document, pageId, busy, onChange, onNavigate, onClose, onToast }: Props) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchBase = useRef<{ distance: number; zoom: number } | null>(null);
  const documentRef = useRef(document);
  const rotationJob = useRef(0);
  const [rotating, setRotating] = useState(false);
  const [zoom, setZoom] = useState(1);
  const index = document.pages.findIndex((item) => item.id === pageId);
  const page = document.pages[index];

  useEffect(() => pushBackHandler(() => { onClose(); return true; }), [onClose]);

  useEffect(() => setZoom(1), [pageId]);
  useEffect(() => {
    documentRef.current = document;
  }, [document]);
  useEffect(() => {
    rotationJob.current += 1;
    setRotating(false);
  }, [pageId]);
  useEffect(() => () => {
    rotationJob.current += 1;
  }, []);

  if (!page) {
    return (
      <div className="page-viewer" role="dialog" aria-modal="true">
        <header className="viewer-top"><button className="scan-icon" onClick={onClose} aria-label="Cerrar visor"><X /></button></header>
        <div className="viewer-stage"><p className="viewer-empty">Esta página ya no existe.</p></div>
      </div>
    );
  }

  const goTo = (direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= document.pages.length) return;
    onNavigate(document.pages[target].id);
  };

  const rotate = async () => {
    if (rotating) return;
    const job = ++rotationJob.current;
    setRotating(true);
    try {
      const rotated = await rotatePage(page);
      if (job !== rotationJob.current) return;
      const current = documentRef.current;
      if (!current.pages.some((item) => item.id === rotated.id)) return;
      onChange({ ...current, pages: current.pages.map((item) => item.id === rotated.id ? rotated : item), updatedAt: Date.now() });
    } catch (error) {
      if (job === rotationJob.current) onToast(error instanceof Error ? error.message : 'No se pudo girar la página');
    } finally {
      if (job === rotationJob.current) setRotating(false);
    }
  };

  const share = async () => {
    try {
      const result = await saveOrShare(page.processed, `${document.title} - página ${index + 1}.jpg`);
      onToast(result);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'No se pudo compartir');
    }
  };

  const remove = () => {
    if (rotating) return;
    if (document.pages.length === 1) {
      onToast('El documento necesita al menos una página');
      return;
    }
    if (!window.confirm(`¿Eliminar la página ${index + 1}?`)) return;
    onChange({ ...document, pages: document.pages.filter((item) => item.id !== page.id), updatedAt: Date.now() });
    onClose();
  };

  const applyZoom = (value: number) => setZoom(Math.max(1, Math.min(5, value)));

  const onPointerDown = (event: React.PointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchBase.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinchBase.current) {
      const [a, b] = [...pointers.current.values()];
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinchBase.current.distance);
      applyZoom(pinchBase.current.zoom * ratio);
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchBase.current = null;
  };

  return (
    <div className="page-viewer" role="dialog" aria-modal="true" aria-label={`Página ${index + 1} de ${document.pages.length}`}>
      <header className="viewer-top">
        <button className="scan-icon" onClick={onClose} aria-label="Cerrar visor"><X /></button>
        <span>Página {index + 1} de {document.pages.length}</span>
        <button className="scan-icon" onClick={remove} disabled={busy || rotating} aria-label="Eliminar página"><Trash2 /></button>
      </header>
      <div
        className="viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="viewer-page" style={{ transform: `scale(${zoom})` }}>
          <BlobImage blob={page.processed} alt={`Página ${index + 1}`} />
        </div>
        <div className="viewer-zoom">
          <button className="scan-icon" onClick={() => applyZoom(zoom - 0.5)} aria-label="Alejar"><ZoomOut /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="scan-icon" onClick={() => applyZoom(zoom + 0.5)} aria-label="Acercar"><ZoomIn /></button>
        </div>
      </div>
      <footer className="viewer-bar">
        <button className="scan-slot" onClick={() => goTo(-1)} disabled={busy || rotating || index === 0} aria-label="Página anterior"><ChevronLeft /></button>
        <button className="scan-slot" onClick={() => void rotate()} disabled={busy} aria-label="Girar página"><span className="scan-slot-icon"><RotateCw /></span><span>Girar</span></button>
        <button className="scan-slot" onClick={() => void share()} disabled={busy || rotating} aria-label="Compartir página"><span className="scan-slot-icon"><Share2 /></span><span>Compartir</span></button>
        <button className="scan-slot" onClick={() => goTo(1)} disabled={busy || rotating || index === document.pages.length - 1} aria-label="Página siguiente"><ChevronRight /></button>
      </footer>
    </div>
  );
}
