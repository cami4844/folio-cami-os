import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Camera, Check, ChevronLeft, ChevronRight, Copy, Crop, FileDown, FileText,
  ImageDown, Languages, MoreVertical, Plus, RotateCw, ScanLine, ScanText, SlidersHorizontal, Trash2, Upload, X,
} from 'lucide-react';
import type { FilterMode, FolioDocument, PageRecord, Quad, Rotation } from '../types';
import { newId } from '../types';
import { pushBackHandler } from '../lib/backStack';
import { usePageSwipe } from '../lib/usePageSwipe';
import { detectDocumentQuad, reprocessPage } from '../lib/image';
import { saveOrShare } from '../lib/files';
import { TRANSLATION_LANGUAGES, translateText, type TranslationLanguage } from '../lib/translate';
import BlobImage from './BlobImage';
import CropEditor from './CropEditor';
import DocumentReader from './DocumentReader';
import PageViewer from './PageViewer';

interface Props {
  document: FolioDocument;
  busy: string;
  onChange: (document: FolioDocument, immediate?: boolean) => void;
  onBack: () => void;
  onAddFiles: () => void;
  onCamera: () => void;
  onRunOcr: (scope: 'page' | 'all', pageId?: string) => void;
  onExportPdf: () => void;
  onExportText: () => void;
  onExportOffice: (kind: 'word' | 'excel') => void;
  onDeleteDocument: () => void;
  onToast: (message: string) => void;
  saveStatus?: 'saving' | 'saved' | 'error';
  startInText?: boolean;
  onStartInTextHandled?: () => void;
}

const FILTERS: { value: FilterMode; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'color', label: 'Mágico' },
  { value: 'gray', label: 'Grises' },
  { value: 'bw', label: 'B/N' },
];

const LONG_PRESS_MS = 450;

export default function Editor({
  document, busy, onChange, onBack, onAddFiles, onCamera, onRunOcr, onExportPdf, onExportText, onExportOffice, onDeleteDocument, onToast, saveStatus = 'saved', startInText = false, onStartInTextHandled,
}: Props) {
  const [selectedId, setSelectedId] = useState(document.pages[0]?.id ?? '');
  const [workspaceMode, setWorkspaceMode] = useState<'reading' | 'editing'>('reading');
  const [cropMode, setCropMode] = useState(false);
  const [activePanel, setActivePanel] = useState<'filter' | 'text' | 'details' | null>(null);
  const [processing, setProcessing] = useState('');
  const [ocrDraft, setOcrDraft] = useState('');
  const [ocrDirty, setOcrDirty] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [translateTarget, setTranslateTarget] = useState<TranslationLanguage>('en');
  const [translated, setTranslated] = useState('');
  const [translateNotice, setTranslateNotice] = useState(false);
  const longPressTimer = useRef<number>(0);
  const longPressFired = useRef(false);
  const longPressStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const processJob = useRef(0);
  const documentRef = useRef(document);
  const page = document.pages.find((item) => item.id === selectedId) ?? document.pages[0];
  const viewerPage = document.pages.find((item) => item.id === viewerId);
  const disabled = Boolean(busy || processing);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    if (!startInText) return;
    setWorkspaceMode('editing');
    setActivePanel('text');
    onStartInTextHandled?.();
  }, [startInText, onStartInTextHandled]);

  useEffect(() => () => {
    processJob.current += 1;
    window.clearTimeout(longPressTimer.current);
  }, []);

  useEffect(() => {
    if (!document.pages.some((item) => item.id === selectedId)) setSelectedId(document.pages[0]?.id ?? '');
  }, [document.pages, selectedId]);

  useEffect(() => {
    setCropMode(false);
    setActivePanel(null);
    setOcrDirty(false);
    setOcrDraft(page?.ocrText ?? '');
    setTranslated('');
    setTranslateNotice(false);
  }, [page?.id]);

  useEffect(() => {
    if (!ocrDirty) setOcrDraft(page?.ocrText ?? '');
  }, [page?.ocrText, ocrDirty]);

  // Capas internas para el botón atrás: visor primero, luego recorte, luego menú.
  useEffect(() => pushBackHandler(() => {
    if (viewerId) { setViewerId(null); return true; }
    if (menuOpen) { setMenuOpen(false); return true; }
    if (selectedPages.size > 0) { setSelectedPages(new Set()); return true; }
    if (activePanel) { setActivePanel(null); return true; }
    if (cropMode) { setCropMode(false); return true; }
    if (workspaceMode === 'editing') { setWorkspaceMode('reading'); return true; }
    return false;
  }), [viewerId, menuOpen, selectedPages.size, activePanel, cropMode, workspaceMode]);

  const commit = (pages: PageRecord[]) => onChange({ ...documentRef.current, pages, updatedAt: Date.now() }, true);

  const process = async (next: PageRecord, message = 'Mejorando imagen…'): Promise<boolean> => {
    const job = ++processJob.current;
    setProcessing(message);
    try {
      const processed = await reprocessPage(next);
      if (job !== processJob.current || !documentRef.current.pages.some((item) => item.id === processed.id)) return false;
      commit(documentRef.current.pages.map((item) => item.id === processed.id ? processed : item));
      return true;
    } catch (error) {
      if (job === processJob.current) onToast(error instanceof Error ? error.message : 'No se pudo procesar la página');
      return false;
    } finally {
      if (job === processJob.current) setProcessing('');
    }
  };

  const detect = async (): Promise<Quad | null> => {
    if (!page) return null;
    setProcessing('Buscando los bordes…');
    try {
      const found = await detectDocumentQuad(page.original);
      return found;
    } catch (error) {
      console.error('[folio] detect error', error);
      return null;
    } finally {
      setProcessing('');
    }
  };

  const autoCrop = async () => {
    const quad = await detect();
    if (!quad) {
      onToast('No detectamos los bordes: usa Recortar y arrastra los 4 puntos.');
      setCropMode(true);
      return;
    }
    await process({ ...page, quad }, 'Recortando y enderezando…');
  };

  const applyCrop = async (quad: Quad) => {
    const applied = await process({ ...page, quad }, 'Aplicando perspectiva…');
    if (applied) setCropMode(false);
  };

  const movePage = (direction: -1 | 1) => {
    const index = document.pages.findIndex((item) => item.id === page.id);
    const target = index + direction;
    if (target < 0 || target >= document.pages.length) return;
    const pages = [...document.pages];
    [pages[index], pages[target]] = [pages[target], pages[index]];
    commit(pages);
  };

  const currentIndex = page ? document.pages.findIndex((item) => item.id === page.id) : -1;
  const selectRelative = (direction: -1 | 1) => {
    const target = currentIndex + direction;
    if (target < 0 || target >= document.pages.length) return;
    setSelectedId(document.pages[target].id);
  };
  const swipeHandlers = usePageSwipe(() => selectRelative(-1), () => selectRelative(1), !cropMode && !activePanel);

  const reorderTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= document.pages.length || to >= document.pages.length) return;
    const pages = [...document.pages];
    const [moved] = pages.splice(from, 1);
    pages.splice(to, 0, moved);
    commit(pages);
  };

  const duplicatePage = () => {
    const index = document.pages.findIndex((item) => item.id === page.id);
    const copy = { ...page, id: newId(), createdAt: Date.now(), ocrText: '' };
    const pages = [...document.pages];
    pages.splice(index + 1, 0, copy);
    commit(pages);
    setSelectedId(copy.id);
  };

  const deletePage = () => {
    if (document.pages.length === 1) {
      onToast('Un documento necesita al menos una página. Puedes eliminarlo desde el menú.');
      return;
    }
    if (!window.confirm('¿Eliminar esta página del documento?')) return;
    const index = document.pages.findIndex((item) => item.id === page.id);
    const pages = document.pages.filter((item) => item.id !== page.id);
    commit(pages);
    setSelectedId(pages[Math.min(index, pages.length - 1)].id);
  };

  const deleteSelectedPages = () => {
    if (selectedPages.size === 0) return;
    if (selectedPages.size >= document.pages.length) {
      onToast('No puedes eliminar todas las páginas: deja al menos una o elimina el documento desde el menú.');
      return;
    }
    if (!window.confirm(`¿Eliminar ${selectedPages.size} páginas seleccionadas?`)) return;
    commit(document.pages.filter((item) => !selectedPages.has(item.id)));
    setSelectedPages(new Set());
    onToast('Páginas eliminadas');
  };

  const duplicateSelectedPages = () => {
    if (selectedPages.size === 0) return;
    const copies = document.pages
      .filter((item) => selectedPages.has(item.id))
      .map((item) => ({ ...item, id: newId(), createdAt: Date.now(), ocrText: '' }));
    commit([...document.pages, ...copies]);
    setSelectedPages(new Set());
    onToast(`${copies.length} páginas duplicadas`);
  };


  const saveOcr = () => {
    if (!page || ocrDraft === page.ocrText) return;
    commit(documentRef.current.pages.map((item) => item.id === page.id ? { ...item, ocrText: ocrDraft } : item));
    setOcrDirty(false);
    onToast('Texto guardado en la página');
  };

  const exportImage = async () => {
    try {
      const result = await saveOrShare(page.processed, `${document.title} - página ${document.pages.indexOf(page) + 1}.jpg`);
      onToast(result);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'No se pudo exportar la imagen');
    }
  };

  const exportWord = () => {
    setMenuOpen(false);
    onExportOffice('word');
  };

  const translateOcr = async () => {
    const text = (ocrDraft || page?.ocrText || '').trim();
    if (!text) {
      onToast('Ejecuta el OCR primero: la traducción usa el texto reconocido.');
      return;
    }
    if (!translateNotice) {
      setTranslateNotice(true);
      return;
    }
    setProcessing('Traduciendo…');
    try {
      const result = await translateText(text, 'es', translateTarget);
      setTranslated(result);
      onToast('Traducción lista. Puedes copiarla o guardarla con el texto.');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'No se pudo traducir');
    } finally {
      setProcessing('');
    }
  };

  const copyTranslation = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Este dispositivo no permite copiar al portapapeles desde la app');
      await navigator.clipboard.writeText(translated);
      onToast('Traducción copiada');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'No se pudo copiar la traducción');
    }
  };

  const startLongPress = (pageId: string, event: React.PointerEvent) => {
    window.clearTimeout(longPressTimer.current);
    if (!event.isPrimary) {
      cancelLongPress();
      return;
    }
    longPressFired.current = false;
    longPressStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      longPressStart.current = null;
      setSelectedPages((current) => {
        const next = new Set(current);
        next.add(pageId);
        return next;
      });
      if (typeof navigator.vibrate === 'function') navigator.vibrate(20);
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    window.clearTimeout(longPressTimer.current);
    longPressStart.current = null;
  };

  const moveLongPress = (event: React.PointerEvent) => {
    const origin = longPressStart.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancelLongPress();
  };

  const handleThumbClick = (pageId: string) => {
    if (longPressFired.current) { longPressFired.current = false; return; }
    if (selectedPages.size > 0) {
      setSelectedPages((current) => {
        const next = new Set(current);
        if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
        return next;
      });
      return;
    }
    setSelectedId(pageId);
  };

  if (workspaceMode === 'reading') {
    return (
      <DocumentReader
        document={document}
        busy={disabled}
        onChange={onChange}
        onBack={onBack}
        onEdit={() => setWorkspaceMode('editing')}
        onExportPdf={onExportPdf}
        onCamera={onCamera}
        onAddFiles={onAddFiles}
        onRunOcr={() => onRunOcr('all')}
        saveStatus={saveStatus}
        pageId={selectedId}
        onPageChange={setSelectedId}
      />
    );
  }

  return (
    <div className="editor-shell studio-shell">
      <header className="editor-header">
        <button className="icon-button back-button" onClick={() => setWorkspaceMode('reading')} aria-label="Volver al lector"><ArrowLeft /></button>
        <div className="editor-title-wrap">
          <span className="eyebrow">Documento</span>
          <input className="editor-title" value={document.title} aria-label="Nombre del documento" onChange={(event) => onChange({ ...document, title: event.target.value, updatedAt: Date.now() })} />
        </div>
        <div className="editor-header-actions">
          <button className="button primary" onClick={onExportPdf} disabled={!document.pages.length || disabled}><FileDown /> Exportar PDF</button>
          <div className="menu-wrap">
            <button className="icon-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Más opciones" aria-expanded={menuOpen} disabled={disabled}><MoreVertical /></button>
            {menuOpen && (
              <div className="dropdown" role="menu">
                <button role="menuitem" disabled={disabled} onClick={() => { setMenuOpen(false); onRunOcr('all'); }}><ScanText /> Sacar texto de todas (OCR)</button>
                <button role="menuitem" disabled={disabled} onClick={exportWord}><FileText /> Exportar Word editable</button>
                <button role="menuitem" disabled={disabled} onClick={() => { setMenuOpen(false); onExportOffice('excel'); }}><FileText /> Exportar Excel</button>
                <button role="menuitem" disabled={disabled || !document.pages.some((item) => item.ocrText)} onClick={() => { setMenuOpen(false); onExportText(); }}><FileText /> Exportar texto (.txt)</button>
                <button role="menuitem" disabled={disabled} onClick={() => { setMenuOpen(false); void exportImage(); }}><ImageDown /> Exportar JPG de la página</button>
                <button role="menuitem" disabled={disabled} onClick={() => { setMenuOpen(false); onAddFiles(); }}><Upload /> Añadir páginas</button>
                <button role="menuitem" disabled={disabled} onClick={() => { setMenuOpen(false); onCamera(); }}><Camera /> Escanear más páginas</button>
                <button role="menuitem" disabled={disabled} className="danger" onClick={() => { setMenuOpen(false); onDeleteDocument(); }}><Trash2 /> Eliminar documento</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {document.pages.length === 0 ? (
        <div className="empty-editor"><h2>Empieza con una página</h2><p>Importa una imagen o PDF, o toma una fotografía.</p><div className="button-row"><button className="button primary" onClick={onCamera}><Camera /> Cámara</button><button className="button secondary" onClick={onAddFiles}><Upload /> Importar</button></div></div>
      ) : page && (
        <div className="studio-body">
          <aside className="page-rail">
            <div className="rail-heading"><span>Páginas</span><strong>{document.pages.length}</strong></div>
            <div className="page-list">
              {document.pages.map((item, index) => (
                <button
                  key={item.id}
                  className={`page-thumb ${item.id === page.id ? 'selected' : ''} ${selectedPages.has(item.id) ? 'multi-selected' : ''}`}
                  onClick={() => handleThumbClick(item.id)}
                  onPointerDown={(event) => startLongPress(item.id, event)}
                  onPointerMove={moveLongPress}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onContextMenu={(event) => { event.preventDefault(); setSelectedPages((current) => { const next = new Set(current); next.add(item.id); return next; }); }}
                  draggable={selectedPages.size === 0}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => { if (dragIndex !== null) reorderTo(dragIndex, index); setDragIndex(null); }}
                  onDragEnd={() => setDragIndex(null)}
                >
                  <span className="page-number">{index + 1}</span>
                  <BlobImage blob={item.thumbnail} alt={`Página ${index + 1}`} />
                  {item.label && <span className="page-label">{item.label}</span>}
                  {item.ocrText && <span className="ocr-dot" title="Tiene OCR"><ScanText /></span>}
                </button>
              ))}
            </div>
            {selectedPages.size > 0 && (
              <div className="selection-actions">
                <strong>{selectedPages.size} seleccionadas</strong>
                <button onClick={duplicateSelectedPages}><Copy /> Duplicar</button>
                <button className="danger" onClick={deleteSelectedPages}><Trash2 /> Eliminar</button>
                <button onClick={() => setSelectedPages(new Set())}><X /> Cancelar</button>
              </div>
            )}
            <div className="rail-add">
              <button className="button secondary" onClick={onCamera} disabled={disabled}><Camera /> Cámara</button>
              <button className="button ghost" onClick={onAddFiles} disabled={disabled}><Plus /> Añadir</button>
            </div>
          </aside>

          <main className="editor-workspace">
            <div className="document-stage" {...swipeHandlers}>
              {cropMode ? (
                <CropEditor page={page} busy={disabled} onApply={(quad) => void applyCrop(quad)} onAuto={detect} onCancel={() => setCropMode(false)} />
              ) : (
                <div className="processed-page">
                  <button className="page-view-open" onClick={() => setViewerId(page.id)} aria-label="Ver página completa" title="Ver completa (zoom y compartir)">
                    <BlobImage blob={page.processed} alt={`Página ${document.pages.indexOf(page) + 1} procesada`} />
                  </button>
                </div>
              )}
              {(processing || busy) && <div className="processing-cover"><span className="spinner" /><strong>{processing || busy}</strong></div>}
            </div>
            <div className="page-position">
              <button className="icon-button" onClick={() => selectRelative(-1)} disabled={currentIndex === 0 || disabled} aria-label="Página anterior"><ChevronLeft /></button>
              <span>Página {currentIndex + 1} de {document.pages.length} · desliza para cambiar</span>
              <button className="icon-button" onClick={() => selectRelative(1)} disabled={currentIndex === document.pages.length - 1 || disabled} aria-label="Página siguiente"><ChevronRight /></button>
            </div>
            {activePanel && (
              <section className={`studio-sheet ${activePanel}`} aria-label={activePanel === 'filter' ? 'Filtros de imagen' : activePanel === 'text' ? 'Texto OCR' : 'Opciones de la página'}>
                <div className="studio-sheet-grip" aria-hidden="true" />
                <header className="studio-sheet-header">
                  <div><span className="eyebrow">Editor de documento</span><h3>{activePanel === 'filter' ? 'Apariencia de la página' : activePanel === 'text' ? 'Texto OCR' : 'Esta página'}</h3></div>
                  <button className="icon-button" onClick={() => setActivePanel(null)} aria-label="Cerrar panel"><X /></button>
                </header>

                {activePanel === 'filter' && (
                  <div className="studio-filter-grid">
                    {FILTERS.map((filter) => (
                      <button key={filter.value} className={page.filter === filter.value ? 'active' : ''} onClick={() => void process({ ...page, filter: filter.value })} disabled={disabled}>
                        <strong>{filter.label}</strong>
                        <span>{filter.value === 'original' ? 'Sin procesar' : filter.value === 'color' ? 'Papel limpio y color natural' : filter.value === 'gray' ? 'Lectura equilibrada' : 'Texto de alto contraste'}</span>
                      </button>
                    ))}
                  </div>
                )}

                {activePanel === 'text' && (
                  <div className="studio-text-panel">
                    <p className="section-help">Español e inglés, sin enviar la página a internet.</p>
                    <div className="button-row"><button className="button secondary" onClick={() => onRunOcr('page', page.id)} disabled={disabled}><ScanText /> Esta página</button><button className="button ghost" onClick={() => onRunOcr('all')} disabled={disabled}>Todo el documento</button></div>
                    <textarea value={ocrDraft} onChange={(event) => { setOcrDraft(event.target.value); setOcrDirty(true); }} placeholder="El texto reconocido aparecerá aquí. También puedes escribir o corregir." aria-label="Texto OCR editable" />
                    <button className="button text-button" onClick={saveOcr} disabled={ocrDraft === page.ocrText}><Check /> Guardar texto</button>
                    <div className="translate-row">
                      <select value={translateTarget} onChange={(event) => setTranslateTarget(event.target.value as TranslationLanguage)} aria-label="Idioma de traducción">
                        {TRANSLATION_LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
                      </select>
                      <button className="button secondary" onClick={() => void translateOcr()} disabled={disabled}><Languages /> Traducir</button>
                    </div>
                    {translateNotice && (
                      <div className="translate-notice">
                        <strong>Traducir usa internet</strong>
                        <p>Es la única función de Folio que sale del dispositivo. Todo lo demás sigue local.</p>
                        <div className="button-row"><button className="button primary" onClick={() => void translateOcr()} disabled={disabled}>Permitir y traducir</button><button className="button ghost" onClick={() => setTranslateNotice(false)}>Cancelar</button></div>
                      </div>
                    )}
                    {translated && (
                      <div className="translated-box">
                        <span className="eyebrow">Traducción ({translateTarget})</span>
                        <textarea value={translated} readOnly aria-label="Texto traducido" />
                        <div className="button-row"><button className="button ghost" onClick={() => void copyTranslation()}>Copiar</button><button className="button ghost" onClick={() => setTranslated('')}>Quitar</button></div>
                      </div>
                    )}
                  </div>
                )}

                {activePanel === 'details' && (
                  <div className="page-details">
                    <dl><div><dt>Dimensiones</dt><dd>{page.width} × {page.height}</dd></div><div><dt>Filtro</dt><dd>{FILTERS.find((item) => item.value === page.filter)?.label}</dd></div><div><dt>Giro</dt><dd>{page.rotation}°</dd></div></dl>
                    <div className="button-row"><button className="button ghost" onClick={() => movePage(-1)} disabled={currentIndex === 0 || disabled}><ChevronLeft /> Mover atrás</button><button className="button ghost" onClick={() => movePage(1)} disabled={currentIndex === document.pages.length - 1 || disabled}>Mover adelante <ChevronRight /></button></div>
                    <button className="button secondary full-button" onClick={() => void exportImage()}><ImageDown /> Exportar JPG</button>
                    <div className="button-row"><button className="button ghost" onClick={duplicatePage} disabled={disabled}><Copy /> Duplicar</button><button className="button danger-ghost" onClick={deletePage} disabled={disabled}><Trash2 /> Eliminar</button></div>
                  </div>
                )}
              </section>
            )}

            <nav className="studio-dock" aria-label="Herramientas de edición">
              <button className={cropMode ? 'active' : ''} onClick={() => { setCropMode((value) => !value); setActivePanel(null); }} disabled={disabled} aria-pressed={cropMode}><Crop /><span>Recortar</span></button>
              <button onClick={() => void autoCrop()} disabled={disabled}><ScanLine /><span>Auto</span></button>
              <button onClick={() => void process({ ...page, rotation: ((page.rotation + 90) % 360) as Rotation }, 'Girando…')} disabled={disabled}><RotateCw /><span>Girar</span></button>
              <button className={activePanel === 'filter' ? 'active' : ''} onClick={() => setActivePanel((current) => current === 'filter' ? null : 'filter')} aria-pressed={activePanel === 'filter'}><SlidersHorizontal /><span>Filtro</span></button>
              <button className={activePanel === 'text' ? 'active' : ''} onClick={() => setActivePanel((current) => current === 'text' ? null : 'text')} aria-pressed={activePanel === 'text'}><ScanText /><span>Texto</span></button>
              <button className={activePanel === 'details' ? 'active' : ''} onClick={() => setActivePanel((current) => current === 'details' ? null : 'details')} aria-pressed={activePanel === 'details'}><FileText /><span>Página</span></button>
            </nav>
          </main>
        </div>
      )}

      {viewerPage && (
        <PageViewer
          document={document}
          pageId={viewerPage.id}
          busy={Boolean(busy || processing)}
          onChange={(updated) => onChange(updated, true)}
          onNavigate={setViewerId}
          onClose={() => setViewerId(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}
