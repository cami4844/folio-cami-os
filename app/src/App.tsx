import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
  Camera, Check, FolderOpen, Home as HomeIcon, LayoutGrid, User, X,
} from 'lucide-react';
import HomeView, { type TabKey } from './components/Home';
import Library, { type LibraryFilter, type LibrarySort } from './components/Library';
import Tools from './components/Tools';
import Me from './components/Me';
import DocPicker from './components/DocPicker';
import Editor from './components/Editor';
import CameraDialog, { type CameraPreset, type ScanShot } from './components/CameraDialog';
import PdfDialog from './components/PdfDialog';
import Logo from './components/Logo';
import type { FilterMode, FolioDocument, PdfOptions, ThemeChoice } from './types';
import { newId } from './types';
import { listDocuments, putDocument, readTheme, removeDocument, saveTheme } from './lib/db';
import { createPage, detectDocumentQuad, type ScanShot as ImageScanShot } from './lib/image';
import { importPdfPages } from './lib/pdfImport';
import { requestCameraPermission } from './lib/camera';
import { popBackLayer } from './lib/backStack';
import { recognizePages } from './lib/ocr';
import { createDocumentPdf, pdfFileName } from './lib/pdf';
import { documentTextFile } from './lib/exportText';
import { documentWordFile } from './lib/docx';
import { documentExcelFile } from './lib/xlsx';
import { saveOrShare } from './lib/files';

const TABS: { key: TabKey; label: string; icon: typeof HomeIcon }[] = [
  { key: 'home', label: 'Inicio', icon: HomeIcon },
  { key: 'files', label: 'Documentos', icon: FolderOpen },
  { key: 'tools', label: 'Herramientas', icon: LayoutGrid },
  { key: 'me', label: 'Ajustes', icon: User },
];

type PickPurpose = 'pdf' | 'ocr' | 'text' | 'word' | 'excel' | 'edit' | 'translate' | 'duplicate';

interface CameraSession { preset: CameraPreset; targetId?: string }

export default function App() {
  const [documents, setDocuments] = useState<FolioDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState('Abriendo biblioteca…');
  const [toast, setToast] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saved');
  const saveRevision = useRef(0);
  const [tab, setTab] = useState<TabKey>('home');
  const [cameraSession, setCameraSession] = useState<CameraSession | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [picker, setPicker] = useState<PickPurpose | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const inputTarget = useRef<string | undefined>(undefined);
  const exitArmed = useRef(0);
  const suppressPopstate = useRef(false);
  const persistTimers = useRef(new Map<string, number>());
  const persistQueue = useRef(new Map<string, FolioDocument>());
  const writeChains = useRef(new Map<string, Promise<boolean>>());
  const documentsRef = useRef<FolioDocument[]>([]);
  const deletedDocumentIds = useRef(new Set<string>());
  const [editorIntent, setEditorIntent] = useState<'text' | null>(null);
  const activeDocument = documents.find((document) => document.id === activeId);

  useEffect(() => {
    void Promise.all([listDocuments(), readTheme()]).then(([stored, storedTheme]) => {
      documentsRef.current = stored;
      setDocuments(stored);
      setTheme(storedTheme);
    }).catch((error: unknown) => {
      setToast(error instanceof Error ? error.message : 'No se pudo abrir la biblioteca');
    }).finally(() => setBusy(''));
  }, []);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    void saveTheme(theme).catch(() => undefined);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openDocument = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const closeDocument = useCallback(() => {
    setActiveId(null);
    setEditorIntent(null);
    setPdfOpen(false);
  }, []);

  /* ===== C1: una sola función de retroceso para Android, ESC y el navegador ===== */
  const handleBack = useCallback(() => {
    // 1) El diálogo visible superior se cierra antes que cualquier panel interno.
    if (pdfOpen) { setPdfOpen(false); return; }
    if (popBackLayer()) {
      if (openLayers > 0) window.history.pushState({ folioLayer: true }, '');
      return;
    }

    // 2) Capas de App, de la más profunda a la más superficial.
    if (cameraSession) { setCameraSession(null); return; }
    if (picker) { setPicker(null); return; }
    if (activeDocument) { closeDocument(); return; }
    if (tab !== 'home') { setTab('home'); return; }

    // 3) En inicio: segundo pulso para salir (Android) o aviso.
    if (Capacitor.isNativePlatform()) {
      const now = Date.now();
      if (now - exitArmed.current < 2600) {
        void CapacitorApp.exitApp();
      } else {
        exitArmed.current = now;
        setToast('Presiona atrás otra vez para salir de Folio');
      }
      return;
    }
    setToast('Estás en el inicio de Folio');
  }, [cameraSession, picker, pdfOpen, activeDocument, tab, closeDocument]);

  // Botón atrás físico de Android.
  useEffect(() => {
    let subscription: { remove: () => void } | undefined;
    void CapacitorApp.addListener('backButton', () => handleBack()).then((listener) => {
      subscription = listener;
    });
    return () => subscription?.remove();
  }, [handleBack]);

  // Tecla ESC en escritorio.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      handleBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleBack]);

  // Botón atrás del navegador: un centinela por capa abierta.
  const openLayers = (cameraSession ? 1 : 0) + (picker ? 1 : 0) + (pdfOpen ? 1 : 0) + (activeDocument ? 1 : 0);
  useEffect(() => {
    if (openLayers === 0) return;
    window.history.pushState({ folioLayer: true }, '');
    return () => {
      if (!window.history.state?.folioLayer) return;
      suppressPopstate.current = true;
      window.history.back();
    };
  }, [openLayers]);

  useEffect(() => {
    const onPopstate = () => {
      if (suppressPopstate.current) {
        suppressPopstate.current = false;
        return;
      }
      handleBack();
    };
    window.addEventListener('popstate', onPopstate);
    return () => window.removeEventListener('popstate', onPopstate);
  }, [handleBack]);

  // El editor registra sus capas internas (recorte/visor/menú/selección) por sí mismo.

  const replaceDocument = useCallback((document: FolioDocument) => {
    const current = documentsRef.current;
    const exists = current.some((item) => item.id === document.id);
    const next = exists ? current.map((item) => item.id === document.id ? document : item) : [document, ...current];
    documentsRef.current = next;
    setDocuments(next);
  }, []);

  const queueDocumentWrite = useCallback((document: FolioDocument): Promise<boolean> => {
    if (deletedDocumentIds.current.has(document.id)) return Promise.resolve(false);
    const revision = saveRevision.current;
    persistQueue.current.set(document.id, document);
    const previous = writeChains.current.get(document.id) ?? Promise.resolve(true);
    const operation = previous.then(async () => {
      if (deletedDocumentIds.current.has(document.id)) return false;
      const latest = persistQueue.current.get(document.id);
      persistQueue.current.delete(document.id);
      if (!latest || deletedDocumentIds.current.has(document.id)) return false;
      try {
        await putDocument(latest);
        if (revision === saveRevision.current) setSaveStatus('saved');
        return true;
      } catch (error) {
        if (revision === saveRevision.current) setSaveStatus('error');
        setToast(error instanceof Error ? `No se pudo guardar: ${error.message}` : 'No se pudo guardar');
        return false;
      }
    });
    writeChains.current.set(document.id, operation);
    void operation.finally(() => {
      if (writeChains.current.get(document.id) === operation) writeChains.current.delete(document.id);
    });
    return operation;
  }, []);

  const commitDocument = useCallback((document: FolioDocument, immediate = false): Promise<boolean> => {
    if (deletedDocumentIds.current.has(document.id)) return Promise.resolve(false);
    saveRevision.current += 1;
    setSaveStatus('saving');
    replaceDocument(document);
    persistQueue.current.set(document.id, document);
    const previousTimer = persistTimers.current.get(document.id);
    if (previousTimer) window.clearTimeout(previousTimer);
    persistTimers.current.delete(document.id);
    if (immediate) return queueDocumentWrite(document);
    const timer = window.setTimeout(() => {
      persistTimers.current.delete(document.id);
      const latest = persistQueue.current.get(document.id);
      if (latest) void queueDocumentWrite(latest);
    }, 320);
    persistTimers.current.set(document.id, timer);
    return Promise.resolve(true);
  }, [queueDocumentWrite, replaceDocument]);

  const updateDocument = useCallback((id: string, update: (current: FolioDocument) => FolioDocument, immediate = true) => {
    if (deletedDocumentIds.current.has(id)) return null;
    const current = documentsRef.current.find((item) => item.id === id);
    if (!current) return null;
    const updated = update(current);
    void commitDocument(updated, immediate);
    return updated;
  }, [commitDocument]);

  const flushDocumentWrites = useCallback(() => {
    persistTimers.current.forEach((timer) => window.clearTimeout(timer));
    persistTimers.current.clear();
    const queued = [...persistQueue.current.values()];
    persistQueue.current.clear();
    return Promise.all(queued.filter((document) => !deletedDocumentIds.current.has(document.id)).map((document) => queueDocumentWrite(document)));
  }, [queueDocumentWrite]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushDocumentWrites();
    };
    const onPageHide = () => { void flushDocumentWrites(); };
    let subscription: { remove: () => void } | undefined;
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    void CapacitorApp.addListener('pause', onPageHide).then((listener) => { subscription = listener; });
    return () => {
      subscription?.remove();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void flushDocumentWrites();
    };
  }, [flushDocumentWrites]);

  const addShots = async (shots: ImageScanShot[], targetId?: string, preset: FilterMode = 'original', title?: string) => {
    if (!shots.length) return;
    setBusy(`Preparando 0 de ${shots.length} páginas…`);
    try {
      const pages = [];
      for (let index = 0; index < shots.length; index += 1) {
        setBusy(`Preparando ${index + 1} de ${shots.length} páginas…`);
        pages.push(await createPage(shots[index], preset));
      }
      const target = targetId ? documentsRef.current.find((document) => document.id === targetId) : undefined;
      if (targetId && !target) throw new Error('El documento de destino ya no existe. No se añadieron las páginas.');
      const now = Date.now();
      const stamp = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(now);
      const document: FolioDocument = target
        ? { ...target, pages: [...target.pages, ...pages], updatedAt: now }
        : {
            id: newId(),
            title: title ?? `Escaneo ${stamp}`,
            createdAt: now,
            updatedAt: now,
            favorite: false,
            pages,
          };
      const saved = await commitDocument(document, true);
      setActiveId(document.id);
      setToast(saved
        ? `${pages.length} ${pages.length === 1 ? 'página añadida' : 'páginas añadidas'} · guardado local`
        : 'Las páginas están abiertas, pero el guardado local falló');
    } catch (error) {
      console.error('Folio no pudo preparar las páginas', error);
      setToast(error instanceof Error ? error.message : 'No se pudieron preparar las páginas');
    } finally {
      setBusy('');
    }
  };

  const openImport = (targetId?: string) => {
    if (busy) {
      setToast('Espera a que termine la operación actual antes de importar');
      return;
    }
    inputTarget.current = targetId;
    input.current?.click();
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setCameraSession(null);
    const target = inputTarget.current;
    try {
      const shots: ImageScanShot[] = [];
      const plain: Blob[] = [];
      for (const file of files) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          setBusy(`Leyendo ${file.name}…`);
          plain.push(...await importPdfPages(file, (done, total) => setBusy(`PDF: página ${done} de ${total}`)));
        } else if (file.type.startsWith('image/')) {
          shots.push({ blob: file });
        } else {
          throw new Error(`${file.name}: formato no compatible. Usa JPG, PNG, WebP o PDF.`);
        }
      }
      // Las imágenes importadas se enderezan solas si detectamos el documento.
      for (const shot of shots) {
        setBusy(`Detectando bordes de ${shots.indexOf(shot) + 1} de ${shots.length}…`);
        try {
          shot.quad = (await detectDocumentQuad(shot.blob)) ?? undefined;
        } catch {
          shot.quad = undefined;
        }
      }
      const pdfShots: ImageScanShot[] = plain.map((blob) => ({ blob }));
      await addShots([...shots, ...pdfShots], target);
    } catch (error) {
      setBusy('');
      setToast(error instanceof Error ? error.message : 'No se pudieron importar los archivos');
    }
  };

  const openCamera = async (preset: CameraPreset = 'scan', targetId?: string) => {
    if (busy) {
      setToast('Espera a que termine la operación actual antes de escanear');
      return;
    }
    if (Capacitor.isNativePlatform()) await requestCameraPermission();
    setCameraSession({ preset, targetId });
  };

  const runOcrOn = async (document: FolioDocument): Promise<FolioDocument | null> => {
    try {
      const results = await recognizePages(document.pages, (page, total, progress, status) => {
        setBusy(`OCR ${page}/${total} · ${status} ${Math.round(progress * 100)} %`);
      });
      const textById = new Map(document.pages.map((page, index) => [page.id, results[index]]));
      const updated = updateDocument(document.id, (current) => ({
        ...current,
        pages: current.pages.map((page) => textById.has(page.id) ? { ...page, ocrText: textById.get(page.id)! } : page),
        updatedAt: Date.now(),
      }));
      if (!updated) return null;
      setToast('OCR terminado y guardado. Ya puedes buscar, exportar Word o traducir.');
      return updated;
    } catch (error) {
      setToast(error instanceof Error ? `OCR: ${error.message}` : 'No se pudo reconocer el texto');
      return null;
    } finally {
      setBusy('');
    }
  };

  const ensureCompleteOcr = async (source: FolioDocument): Promise<FolioDocument | null> => {
    const missing = source.pages.filter((page) => !page.ocrText.trim());
    if (!missing.length) return source;
    const results = await recognizePages(missing, (page, total, progress, status) => {
      setBusy(`OCR ${page}/${total} · ${status} ${Math.round(progress * 100)} %`);
    });
    const textById = new Map(missing.map((page, index) => [page.id, results[index]]));
    return updateDocument(source.id, (current) => ({
      ...current,
      pages: current.pages.map((page) => textById.has(page.id) ? { ...page, ocrText: textById.get(page.id)! } : page),
      updatedAt: Date.now(),
    }));
  };

  const exportOffice = async (source: FolioDocument, kind: 'word' | 'excel') => {
    setBusy(kind === 'word' ? 'Creando Word…' : 'Creando Excel…');
    try {
      const target = await ensureCompleteOcr(source);
      if (!target) return;
      const { blob, fileName } = kind === 'word'
        ? documentWordFile(target)
        : documentExcelFile(target);
      setToast(await saveOrShare(blob, fileName));
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'No se pudo crear el documento');
    } finally {
      setBusy('');
    }
  };

  const runOcrEditor = async (scope: 'page' | 'all', pageId?: string): Promise<FolioDocument | null> => {
    if (!activeDocument) return null;
    const documentId = activeDocument.id;
    const targets = scope === 'all' ? activeDocument.pages : activeDocument.pages.filter((page) => page.id === pageId);
    if (!targets.length) return null;
    try {
      const results = await recognizePages(targets, (page, total, progress, status) => {
        setBusy(`OCR ${page}/${total} · ${status} ${Math.round(progress * 100)} %`);
      });
      const textById = new Map(targets.map((page, index) => [page.id, results[index]]));
      const updated = updateDocument(documentId, (current) => ({
        ...current,
        pages: current.pages.map((page) => textById.has(page.id) ? { ...page, ocrText: textById.get(page.id)! } : page),
        updatedAt: Date.now(),
      }));
      if (!updated) return null;
      setToast('OCR terminado y guardado. Ya puedes buscar, exportar Word o traducir.');
      return updated;
    } catch (error) {
      setToast(error instanceof Error ? `OCR: ${error.message}` : 'No se pudo reconocer el texto');
      return null;
    } finally {
      setBusy('');
    }
  };

  const exportPdf = async (options: PdfOptions, prepared?: Blob) => {
    if (!activeDocument) return;
    setPdfOpen(false);
    setBusy(prepared ? 'Guardando PDF…' : 'Creando PDF…');
    try {
      const pdf = prepared ?? await createDocumentPdf(activeDocument, options, (done, total) => setBusy(`PDF: página ${done} de ${total}`));
      setToast(await saveOrShare(pdf, pdfFileName(activeDocument)));
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'No se pudo crear el PDF');
    } finally {
      setBusy('');
    }
  };

  const exportTextDoc = async (document: FolioDocument) => {
    try {
      const { blob, fileName } = documentTextFile(document);
      setToast(await saveOrShare(blob, fileName));
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'No se pudo exportar el texto');
    }
  };

  const deleteDocument = async (document: FolioDocument) => {
    if (!window.confirm(`¿Eliminar «${document.title}» y sus ${document.pages.length} páginas de este dispositivo?`)) return;
    deletedDocumentIds.current.add(document.id);
    const timer = persistTimers.current.get(document.id);
    if (timer) window.clearTimeout(timer);
    persistTimers.current.delete(document.id);
    persistQueue.current.delete(document.id);
    setBusy('Eliminando documento…');
    try {
      const pending = writeChains.current.get(document.id);
      if (pending) await pending;
      await removeDocument(document.id);
      const next = documentsRef.current.filter((item) => item.id !== document.id);
      documentsRef.current = next;
      setDocuments(next);
      setSelected((current) => new Set([...current].filter((id) => id !== document.id)));
      if (activeId === document.id) setActiveId(null);
      setToast('Documento eliminado');
    } catch (error) {
      deletedDocumentIds.current.delete(document.id);
      setToast(error instanceof Error ? `No se pudo eliminar: ${error.message}` : 'No se pudo eliminar el documento');
    } finally {
      setBusy('');
    }
  };

  const duplicateDocument = (source: FolioDocument) => {
    const now = Date.now();
    const copy: FolioDocument = {
      ...source,
      id: newId(),
      title: `${source.title} · copia`,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      pages: source.pages.map((page) => ({ ...page, id: newId(), createdAt: now })),
    };
    void commitDocument(copy, true);
    setToast('Documento duplicado');
  };

  const mergeSelected = () => {
    const sources = documentsRef.current.filter((document) => selected.has(document.id));
    if (sources.length < 2) {
      setTab('files');
      setToast('Selecciona al menos dos documentos en la pestaña Documentos para combinarlos.');
      return;
    }
    const now = Date.now();
    const merged: FolioDocument = {
      id: newId(),
      title: 'Documento combinado',
      createdAt: now,
      updatedAt: now,
      favorite: false,
      pages: sources.flatMap((document) => document.pages.map((page) => ({ ...page, id: newId(), createdAt: now }))),
    };
    void commitDocument(merged, true);
    setSelected(new Set());
    setActiveId(merged.id);
    setToast(`${sources.length} documentos combinados`);
  };

  const handlePick = (document: FolioDocument) => {
    const purpose = picker;
    setPicker(null);
    if (!purpose) return;
    if (purpose === 'pdf') { openDocument(document.id); setPdfOpen(true); }
    if (purpose === 'ocr') { setBusy('Preparando OCR…'); void runOcrOn(document); }
    if (purpose === 'text') void exportTextDoc(document);
    if (purpose === 'word' || purpose === 'excel') void exportOffice(document, purpose);
    if (purpose === 'edit' || purpose === 'translate') {
      openDocument(document.id);
      setEditorIntent(purpose === 'translate' ? 'text' : null);
    }
    if (purpose === 'duplicate') duplicateDocument(document);
  };

  const visibleDocuments = useCallback(() => {
    const query = search.trim().toLocaleLowerCase('es');
    return documents.filter((document) => {
      if (filter === 'favorites' && !document.favorite) return false;
      if (!query) return true;
      return document.title.toLocaleLowerCase('es').includes(query)
        || document.pages.some((page) => page.ocrText.toLocaleLowerCase('es').includes(query));
    }).sort((a, b) => {
      if (sort === 'name') return a.title.localeCompare(b.title, 'es');
      if (sort === 'pages') return b.pages.length - a.pages.length;
      return b.updatedAt - a.updatedAt;
    });
  }, [documents, filter, search, sort]);

  return (
    <>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
        multiple
        onChange={(event) => { void handleFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }}
      />
      {activeDocument ? (
        <Editor
          document={activeDocument}
          busy={busy}
          onChange={commitDocument}
          onBack={closeDocument}
          onAddFiles={() => openImport(activeDocument.id)}
          onCamera={() => void openCamera('scan', activeDocument.id)}
          onRunOcr={(scope, pageId) => void runOcrEditor(scope, pageId)}
          onExportPdf={() => setPdfOpen(true)}
          onExportText={() => void exportTextDoc(activeDocument)}
          onExportOffice={(kind) => void exportOffice(activeDocument, kind)}
          onDeleteDocument={() => void deleteDocument(activeDocument)}
          onToast={setToast}
          saveStatus={saveStatus}
          startInText={editorIntent === 'text'}
          onStartInTextHandled={() => setEditorIntent(null)}
        />
      ) : (
        <div className="shell">
          <header className="shell-top">
            <Logo compact />
            <span className="shell-local">Local · sin cuentas · sin anuncios</span>
          </header>

          <main className="shell-main">
            {tab === 'home' && (
              <HomeView
                documents={visibleDocuments()}
                busy={Boolean(busy)}
                onTab={setTab}
                onCamera={(preset) => void openCamera(preset)}
                onImport={() => openImport()}
                onOpen={openDocument}
                onOcrAll={() => {
                  if (documents.length === 0) { setToast('Aún no hay documentos. Escanea o importa uno primero.'); return; }
                  if (documents.length === 1) { setBusy('Preparando OCR…'); void runOcrOn(documents[0]); return; }
                  setPicker('ocr');
                }}
              />
            )}
            {tab === 'files' && (
              <Library
                documents={visibleDocuments()}
                busy={Boolean(busy)}
                search={search}
                filter={filter}
                sort={sort}
                selected={selected}
                onSearch={setSearch}
                onFilter={setFilter}
                onSort={setSort}
                onToggleSelect={(id) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                onClearSelection={() => setSelected(new Set())}
                onOpen={openDocument}
                onCamera={(preset) => void openCamera(preset)}
                onImport={() => openImport()}
                onDelete={(document) => void deleteDocument(document)}
                onDuplicate={duplicateDocument}
                onFavorite={(document) => commitDocument({ ...document, favorite: !document.favorite, updatedAt: Date.now() })}
                onMerge={mergeSelected}
              />
            )}
            {tab === 'tools' && (
              <Tools
                busy={Boolean(busy)}
                onCamera={(preset) => void openCamera(preset)}
                onImport={() => openImport()}
                onPickFor={setPicker}
                onMerge={mergeSelected}
              />
            )}
            {tab === 'me' && <Me documents={documents} theme={theme} onTheme={setTheme} />}
          </main>

          <nav className="tab-nav" aria-label="Navegación principal">
            <div className="tab-nav-pill">
              {TABS.slice(0, 2).map((item) => (
                <button key={item.key} className={`tab-button ${tab === item.key ? 'active' : ''}`} onClick={() => setTab(item.key)} aria-current={tab === item.key ? 'page' : undefined}>
                  <item.icon /><span>{item.label}</span>
                </button>
              ))}
              <button className="tab-scan" onClick={() => void openCamera()} disabled={Boolean(busy)} aria-label="Escanear con la cámara">
                <Camera /><span>Escanear</span>
              </button>
              {TABS.slice(2).map((item) => (
                <button key={item.key} className={`tab-button ${tab === item.key ? 'active' : ''}`} onClick={() => setTab(item.key)} aria-current={tab === item.key ? 'page' : undefined}>
                  <item.icon /><span>{item.label}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>
      )}

      {cameraSession && (
        <CameraDialog
          initialPreset={cameraSession.preset}
          onClose={() => setCameraSession(null)}
          onDone={(shots, preset) => {
            setCameraSession(null);
            const presetFilter: FilterMode = preset === 'board' ? 'bw' : 'original';
            const title = preset === 'id'
              ? `Cédula ${new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(Date.now())}`
              : undefined;
            void addShots(shots, cameraSession.targetId, presetFilter, title);
          }}
          onImport={() => openImport(cameraSession.targetId)}
          onNativeFallback={async () => {
            const { captureNativePhoto } = await import('./lib/camera');
            return captureNativePhoto();
          }}
        />
      )}
      {pdfOpen && activeDocument && <PdfDialog document={activeDocument} busy={Boolean(busy)} onClose={() => setPdfOpen(false)} onExport={(options, prepared) => void exportPdf(options, prepared)} />}
      {picker && !activeDocument && (
        <DocPicker
          title="Elegir documento"
          hint="¿Sobre cuál documento quieres hacer esto?"
          documents={documents}
          onPick={handlePick}
          onClose={() => setPicker(null)}
        />
      )}

      {busy && !activeDocument && <div className="busy-overlay"><span className="spinner" /><strong>{busy}</strong></div>}
      {toast && <div className="toast" role="status"><Check /><span>{toast}</span><button onClick={() => setToast('')} aria-label="Cerrar aviso"><X /></button></div>}
    </>
  );
}
