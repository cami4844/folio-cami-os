import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Camera, FolderUp, Plus, X } from 'lucide-react';
import { pushBackHandler } from '../lib/backStack';

interface Props {
  open: boolean;
  onClose: () => void;
  onCamera: () => void;
  onImport: () => void;
}

export default function AddPagesMenu({ open, onClose, onCamera, onImport }: Props) {
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => {
      onClose();
      return true;
    });
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="add-pages-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="add-pages-sheet" role="dialog" aria-modal="true" aria-labelledby="add-pages-title">
        <div className="add-pages-grip" aria-hidden="true" />
        <header>
          <div><span className="eyebrow">Nueva página</span><h2 id="add-pages-title">Añadir al documento</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar menú de añadir"><X /></button>
        </header>
        <div className="add-pages-options">
          <button onClick={() => { onClose(); onCamera(); }}>
            <span className="add-pages-icon"><Camera /></span>
            <strong>Escanear</strong>
            <small>Usa la cámara y la detección de bordes</small>
          </button>
          <button onClick={() => { onClose(); onImport(); }}>
            <span className="add-pages-icon"><FolderUp /></span>
            <strong>Importar</strong>
            <small>JPG, PNG, WebP o PDF desde tu dispositivo</small>
          </button>
        </div>
        <p className="add-pages-note"><Plus /> Las páginas nuevas se añaden al documento actual.</p>
      </section>
    </div>,
    document.body,
  );
}
