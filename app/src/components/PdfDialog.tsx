import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileDown, X } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { DEFAULT_PDF_OPTIONS, type FolioDocument, type PdfOptions } from '../types';
import { createDocumentPdf } from '../lib/pdf';

GlobalWorkerOptions.workerPort = new PdfWorker();

interface Props {
  document: FolioDocument;
  busy: boolean;
  onClose: () => void;
  onExport: (options: PdfOptions, prepared?: Blob) => void;
}

export default function PdfDialog({ document, busy, onClose, onExport }: Props) {
  const [options, setOptions] = useState<PdfOptions>(DEFAULT_PDF_OPTIONS);
  const [prepared, setPrepared] = useState<Blob | null>(null);
  const [previewBusy, setPreviewBusy] = useState(true);
  const [previewError, setPreviewError] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(document.pages.length);
  const [previewWidth, setPreviewWidth] = useState(520);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadedTaskRef = useRef<ReturnType<typeof getDocument> | null>(null);
  const pdfGeneration = useRef(0);
  const pdfGenerationChain = useRef<Promise<void>>(Promise.resolve());
  const renderTaskRef = useRef<{ promise: Promise<void>; cancel: () => void } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewStage = useRef<HTMLDivElement>(null);
  const update = <K extends keyof PdfOptions>(key: K, value: PdfOptions[K]) => setOptions((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const stage = previewStage.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setPreviewWidth(Math.round(entry.contentRect.width)));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const generation = ++pdfGeneration.current;
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    setPrepared(null);
    setPreviewBusy(true);
    setPreviewError('');
    const timer = window.setTimeout(() => {
      pdfGenerationChain.current = pdfGenerationChain.current.catch(() => undefined).then(async () => {
        if (generation !== pdfGeneration.current) return;
        try {
          const blob = await createDocumentPdf(document, options);
          if (generation !== pdfGeneration.current) return;
          loadingTask = getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
          const pdf = await loadingTask.promise;
          if (generation !== pdfGeneration.current) {
            await loadingTask.destroy();
            return;
          }
          await loadedTaskRef.current?.destroy();
          loadedTaskRef.current = loadingTask;
          pdfRef.current = pdf;
          setPrepared(blob);
          setPageCount(pdf.numPages);
          setPageNumber((current) => Math.min(current, pdf.numPages));
          setPreviewError('');
        } catch (error) {
          if (generation === pdfGeneration.current) setPreviewError(error instanceof Error ? error.message : 'No se pudo preparar la vista previa');
        } finally {
          if (generation === pdfGeneration.current) setPreviewBusy(false);
        }
      });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      if (generation === pdfGeneration.current) pdfGeneration.current += 1;
      void loadingTask?.destroy();
    };
  }, [document, options]);

  useEffect(() => () => {
    void loadedTaskRef.current?.destroy();
  }, []);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || previewBusy) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | undefined;
    void (async () => {
      let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | undefined;
      try {
        const previous = renderTaskRef.current;
        if (previous) {
          previous.cancel();
          await previous.promise.catch(() => undefined);
        }
        if (cancelled) return;
        page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.max(0.5, Math.min(2.2, (previewWidth - 40) / base.width));
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d', { alpha: false })!;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        renderTask = page.render({ canvasContext: context, canvas, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!cancelled) setPreviewError('');
      } catch (error) {
        if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'No se pudo dibujar la página PDF');
      } finally {
        page?.cleanup();
        if (renderTaskRef.current === renderTask) renderTaskRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [prepared, pageNumber, previewWidth, previewBusy]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pdf-title">
      <div className="modal pdf-modal">
        <header className="modal-header">
          <div><span className="eyebrow">Vista previa real del archivo</span><h2 id="pdf-title">Exportar PDF</h2><p>{document.pages.length} {document.pages.length === 1 ? 'página' : 'páginas'} · {document.title}</p></div>
          <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Cerrar"><X /></button>
        </header>

        <div className="pdf-export-layout">
          <section className="pdf-preview-pane" aria-label="Vista previa del PDF">
            <div className="pdf-preview-status">
              <span>{previewBusy ? 'Actualizando vista previa…' : 'Así quedará tu PDF'}</span>
              <div>
                <button onClick={() => setPageNumber((current) => Math.max(1, current - 1))} disabled={pageNumber <= 1 || previewBusy} aria-label="Página PDF anterior"><ChevronLeft /></button>
                <span>{pageNumber} / {pageCount}</span>
                <button onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))} disabled={pageNumber >= pageCount || previewBusy} aria-label="Página PDF siguiente"><ChevronRight /></button>
              </div>
            </div>
            <div className="pdf-preview-canvas" ref={previewStage}>
              <canvas ref={canvasRef} aria-label={`Página ${pageNumber} del PDF generado`} />
              {previewBusy && <div className="pdf-preview-loading"><span className="spinner" /><strong>Creando vista previa…</strong></div>}
              {previewError && !previewBusy && <p className="pdf-preview-error">{previewError}</p>}
            </div>
          </section>

          <section className="pdf-options-pane">
            <div className="form-grid">
              <label>Tamaño<select value={options.paper} onChange={(event) => update('paper', event.target.value as PdfOptions['paper'])}><option value="a4">A4</option><option value="letter">Carta</option><option value="original">Tamaño de imagen</option></select></label>
              <label>Orientación<select value={options.orientation} onChange={(event) => update('orientation', event.target.value as PdfOptions['orientation'])} disabled={options.paper === 'original'}><option value="auto">Automática</option><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label>
              <label>Margen: {options.margin} pt<input type="range" min="0" max="56" step="2" value={options.margin} onChange={(event) => update('margin', Number(event.target.value))} /></label>
              <label>Calidad: {Math.round(options.quality * 100)} %<input type="range" min="0.55" max="1" step="0.05" value={options.quality} onChange={(event) => update('quality', Number(event.target.value))} /></label>
              <label className="full-field">Marca de agua (opcional)<input value={options.watermark} maxLength={90} placeholder="Ej.: Copia de Cami" onChange={(event) => update('watermark', event.target.value)} /></label>
              <label className="check-row"><input type="checkbox" checked={options.pageNumbers} onChange={(event) => update('pageNumbers', event.target.checked)} /> Numerar páginas</label>
              <label className="check-row"><input type="checkbox" checked={options.includeOcr} onChange={(event) => update('includeOcr', event.target.checked)} /> Incluir capa de texto OCR</label>
            </div>
            <div className="modal-note">El PDF y esta vista previa se crean en tu dispositivo. Lo que ves aquí es el mismo archivo que vas a guardar.</div>
          </section>
        </div>

        <footer className="modal-actions"><button className="button ghost" onClick={onClose} disabled={busy}>Cancelar</button><button className="button primary" onClick={() => onExport(options, prepared ?? undefined)} disabled={busy || previewBusy || !prepared || Boolean(previewError)}><FileDown /> {busy ? 'Guardando…' : 'Crear y guardar PDF'}</button></footer>
      </div>
    </div>
  );
}
