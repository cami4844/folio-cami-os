import { FilePlus2, X } from 'lucide-react';
import type { FolioDocument } from '../types';
import BlobImage from './BlobImage';

interface Props {
  title: string;
  hint: string;
  documents: FolioDocument[];
  onPick: (document: FolioDocument) => void;
  onClose: () => void;
}

export default function DocPicker({ title, hint, documents, onPick, onClose }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal picker-modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div><h2>{title}</h2><p>{hint}</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar selector"><X /></button>
        </header>
        {documents.length === 0 ? (
          <p className="picker-empty">Todavía no hay documentos. Escanea o importa algo primero.</p>
        ) : (
          <div className="picker-list">
            {[...documents].sort((a, b) => b.updatedAt - a.updatedAt).map((document) => (
              <button key={document.id} className="picker-row" onClick={() => onPick(document)}>
                <span className="picker-thumb">
                  {document.pages[0]
                    ? <BlobImage blob={document.pages[0].thumbnail} alt={`Portada de ${document.title}`} />
                    : <FilePlus2 />}
                </span>
                <span className="picker-info">
                  <strong>{document.title}</strong>
                  <span>{document.pages.length} {document.pages.length === 1 ? 'página' : 'páginas'}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
