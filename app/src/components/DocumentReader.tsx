import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, FileDown, FileText,
  Maximize2, Minimize2, Pencil, Plus, ScanText, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { FolioDocument } from '../types';
import { usePageSwipe } from '../lib/usePageSwipe';
import BlobImage from './BlobImage';
import AddPagesMenu from './AddPagesMenu';

interface Props {
  document: FolioDocument;
  busy: boolean;
  onChange: (document: FolioDocument) => void;
  onBack: () => void;
  onEdit: () => void;
  onExportPdf: () => void;
  onCamera: () => void;
  onAddFiles: () => void;
  onRunOcr: () => void;
  saveStatus?: 'saving' | 'saved' | 'error';
  pageId?: string;
  onPageChange?: (pageId: string) => void;
}

type ReadingMode = 'continuous' | 'single';

export default function DocumentReader({
  document, busy, onChange, onBack, onEdit, onExportPdf, onCamera, onAddFiles, onRunOcr, saveStatus = 'saved', pageId, onPageChange,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const pageElements = useRef(new Map<string, HTMLElement>());
  const scrollFrame = useRef(0);
  const [selectedId, setSelectedId] = useState(pageId ?? document.pages[0]?.id ?? '');
  const [mode, setMode] = useState<ReadingMode>(() => window.matchMedia('(max-width: 640px)').matches ? 'single' : 'continuous');
  const [zoom, setZoom] = useState(1);
  const [stageWidth, setStageWidth] = useState(900);
  const [stageHeight, setStageHeight] = useState(760);
  const [fullscreen, setFullscreen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const selectedIndex = Math.max(0, document.pages.findIndex((page) => page.id === selectedId));
  const visiblePages = mode === 'single' ? [document.pages[selectedIndex]].filter(Boolean) : document.pages;

  useEffect(() => {
    if (pageId && pageId !== selectedId && document.pages.some((page) => page.id === pageId)) setSelectedId(pageId);
  }, [pageId, document.pages, selectedId]);

  useEffect(() => {
    if (!document.pages.some((page) => page.id === selectedId)) {
      setSelectedId(document.pages[0]?.id ?? '');
    }
  }, [document.pages, selectedId]);

  useEffect(() => {
    const area = scrollArea.current;
    if (!area) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageWidth(Math.round(entry.contentRect.width));
      setStageHeight(Math.round(entry.contentRect.height));
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
  }, []);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(window.document.fullscreenElement));
    window.document.addEventListener('fullscreenchange', onFullscreen);
    return () => window.document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  const goToPage = (index: number, smooth = true) => {
    const target = document.pages[Math.max(0, Math.min(document.pages.length - 1, index))];
    if (!target) return;
    setSelectedId(target.id);
    onPageChange?.(target.id);
    if (mode === 'continuous') {
      pageElements.current.get(target.id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
  };

  const swipeHandlers = usePageSwipe(
    () => goToPage(selectedIndex - 1),
    () => goToPage(selectedIndex + 1),
    mode === 'single' && zoom === 1,
  );

  const handleScroll = () => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      updateCurrentPage();
    });
  };

  const updateCurrentPage = () => {
    if (mode !== 'continuous' || !scrollArea.current) return;
    const top = scrollArea.current.getBoundingClientRect().top;
    let closest = { id: selectedId, distance: Number.POSITIVE_INFINITY };
    for (const [id, element] of pageElements.current) {
      const distance = Math.abs(element.getBoundingClientRect().top - top - 18);
      if (distance < closest.distance) closest = { id, distance };
    }
    if (closest.id !== selectedId) {
      setSelectedId(closest.id);
      onPageChange?.(closest.id);
    }
  };

  const changeZoom = (next: number) => setZoom(Math.max(0.65, Math.min(3, Math.round(next * 20) / 20)));

  const toggleFullscreen = async () => {
    try {
      if (window.document.fullscreenElement) await window.document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      // El lector sigue funcionando aunque el navegador bloquee pantalla completa.
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.matches('input, textarea, select')) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goToPage(selectedIndex + 1);
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToPage(selectedIndex - 1);
      }
      if (event.key === '+' || event.key === '=') changeZoom(zoom + 0.15);
      if (event.key === '-') changeZoom(zoom - 0.15);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const horizontalPadding = stageWidth < 640 ? 24 : 64;
  const referencePage = mode === 'single' ? document.pages[selectedIndex] : document.pages[0];
  const widthToFitHeight = referencePage ? (stageHeight - 72) * (referencePage.width / referencePage.height) : stageWidth;
  const baseWidth = Math.max(250, Math.min(920, stageWidth - horizontalPadding, widthToFitHeight));
  const sheetWidth = Math.round(baseWidth * zoom);

  return (
    <div className="document-reader" ref={root}>
      <header className="reader-header">
        <button className="icon-button reader-back" onClick={onBack} aria-label="Volver a biblioteca"><ArrowLeft /></button>
        <div className="reader-title-block">
          <span className={`reader-kicker ${saveStatus}`}>
            {saveStatus === 'saved' && <Check />}
            {saveStatus === 'saving' ? 'Guardando…' : saveStatus === 'error' ? 'No se pudo guardar' : 'Guardado en este dispositivo'}
          </span>
          <input
            className="reader-title"
            value={document.title}
            aria-label="Nombre del documento"
            onChange={(event) => onChange({ ...document, title: event.target.value, updatedAt: Date.now() })}
          />
        </div>
        <div className="reader-header-actions">
          <button className="button secondary reader-ocr" onClick={onRunOcr} disabled={busy}><ScanText /> Reconocer texto</button>
          <button className="button secondary" onClick={onEdit} disabled={busy}><Pencil /> Editar</button>
          <button className="button primary" onClick={onExportPdf} disabled={busy || !document.pages.length}><FileDown /> Exportar PDF</button>
        </div>
      </header>

      <div className="reader-layout">
        <aside className="reader-rail" aria-label="Miniaturas del documento">
          <div className="reader-rail-heading">
            <span>Páginas</span><strong>{document.pages.length}</strong>
          </div>
          <div className="reader-thumbnails">
            {document.pages.map((page, index) => (
              <button
                key={page.id}
                className={`reader-thumbnail ${page.id === selectedId ? 'active' : ''}`}
                onClick={() => goToPage(index)}
                aria-label={`Ir a página ${index + 1}`}
                aria-current={page.id === selectedId ? 'page' : undefined}
              >
                <span className="reader-thumbnail-number">{index + 1}</span>
                <BlobImage blob={page.thumbnail} alt="" />
              </button>
            ))}
          </div>
          <div className="reader-rail-actions">
            <button onClick={() => setAddOpen(true)} disabled={busy} aria-label="Añadir páginas"><Plus /> Añadir</button>
          </div>
        </aside>

        <main className="reader-main">
          <div className="reader-toolbar">
            <div className="reader-view-switch" aria-label="Modo de lectura">
              <button className={mode === 'continuous' ? 'active' : ''} onClick={() => setMode('continuous')} aria-pressed={mode === 'continuous'}><BookOpen /> Continuo</button>
              <button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')} aria-pressed={mode === 'single'}><FileText /> Una página</button>
            </div>
            <div className="reader-page-nav">
              <button onClick={() => goToPage(selectedIndex - 1)} disabled={selectedIndex === 0} aria-label="Página anterior"><ChevronLeft /></button>
              <span>{selectedIndex + 1} / {document.pages.length}</span>
              <button onClick={() => goToPage(selectedIndex + 1)} disabled={selectedIndex >= document.pages.length - 1} aria-label="Página siguiente"><ChevronRight /></button>
            </div>
            <div className="reader-zoom-controls">
              <button onClick={() => changeZoom(zoom - 0.15)} disabled={zoom <= 0.65} aria-label="Alejar documento"><ZoomOut /></button>
              <button className="reader-zoom-value" onClick={() => setZoom(1)} aria-label="Ajustar zoom al 100 por ciento">{Math.round(zoom * 100)}%</button>
              <button onClick={() => changeZoom(zoom + 0.15)} disabled={zoom >= 3} aria-label="Acercar documento"><ZoomIn /></button>
              <button onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>
            </div>
          </div>

          <div className="reader-scroll" ref={scrollArea} onScroll={handleScroll} {...swipeHandlers} style={{ touchAction: zoom === 1 ? 'pan-y' : 'auto' }}>
            <div className={`reader-pages ${mode}`}>
              {visiblePages.map((page) => {
                const index = document.pages.indexOf(page);
                return (
                  <div className="reader-page-row" key={page.id} style={{ width: Math.max(stageWidth, sheetWidth + horizontalPadding) }}>
                    <article
                      className="reader-sheet"
                      ref={(element) => {
                        if (element) pageElements.current.set(page.id, element);
                        else pageElements.current.delete(page.id);
                      }}
                      style={{ width: sheetWidth }}
                      aria-label={`Página ${index + 1} de ${document.pages.length}`}
                    >
                      <div className="reader-paper" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
                        <BlobImage blob={page.processed} alt={`Página ${index + 1} de ${document.title}`} loading={mode === 'continuous' ? 'lazy' : 'eager'} />
                      </div>
                      <footer><span>{index + 1}</span>{page.label || `${page.width} × ${page.height}`}</footer>
                    </article>
                  </div>
                );
              })}
            </div>
            {busy && <div className="reader-busy"><span className="spinner" /><strong>Actualizando documento…</strong></div>}
          </div>
        </main>
      </div>
      <AddPagesMenu open={addOpen} onClose={() => setAddOpen(false)} onCamera={onCamera} onImport={onAddFiles} />
    </div>
  );
}
