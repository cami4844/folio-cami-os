import {
  Camera, Combine, FileDown, FilePlus2, FolderUp, Grid2x2, ScanText, Star,
} from 'lucide-react';
import type { FolioDocument } from '../types';
import BlobImage from './BlobImage';

export type TabKey = 'home' | 'files' | 'tools' | 'me';

interface Props {
  documents: FolioDocument[];
  busy: boolean;
  onTab: (tab: TabKey) => void;
  onCamera: (preset?: 'scan' | 'id' | 'book' | 'board') => void;
  onImport: () => void;
  onOpen: (id: string) => void;
  onOcrAll: () => void;
}

const dateLabel = (timestamp: number) =>
  new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(timestamp);

export default function Home({ documents, busy, onTab, onCamera, onImport, onOpen, onOcrAll }: Props) {
  const recent = [...documents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const quick: { key: string; label: string; icon: typeof Camera; action: () => void }[] = [
    { key: 'scan', label: 'Escanear', icon: Camera, action: () => onCamera() },
    { key: 'ocr', label: 'Sacar texto', icon: ScanText, action: onOcrAll },
    { key: 'pdf', label: 'Exportar PDF', icon: FileDown, action: () => onTab('tools') },
    { key: 'import', label: 'Importar', icon: FolderUp, action: onImport },
    { key: 'merge', label: 'Combinar', icon: Combine, action: () => onTab('tools') },
    { key: 'favorites', label: 'Favoritos', icon: Star, action: () => onTab('files') },
    { key: 'all', label: 'Documentos', icon: Grid2x2, action: () => onTab('files') },
  ];

  return (
    <div className="home-pane">
      <section className="quick-grid" aria-label="Acciones rápidas">
        {quick.map((item) => (
          <button key={item.key} className="quick-tile" onClick={item.action} disabled={busy}>
            <span className="quick-icon"><item.icon /></span>
            <span className="quick-label">{item.label}</span>
          </button>
        ))}
      </section>

      <section className="recent-block" aria-label="Recientes">
        <header className="recent-head">
          <h2>Recientes</h2>
          <button className="link-button" onClick={() => onTab('files')}>Ver todo</button>
        </header>
        {recent.length === 0 ? (
          <div className="recent-empty">
            <div className="paper-mark" aria-hidden="true">
              <span className="paper-lines"><i /><i /><i /></span>
            </div>
            <p>Sin documento reciente</p>
            <button className="scan-new" onClick={() => onCamera()} disabled={busy}>Escanear documentos nuevos</button>
          </div>
        ) : (
          <div className="recent-strip">
            {recent.map((document) => (
              <article className="recent-card" key={document.id}>
                <button className="recent-open" onClick={() => onOpen(document.id)} aria-label={`Abrir ${document.title}`}>
                  {document.pages[0]
                    ? <BlobImage blob={document.pages[0].thumbnail} alt={`Portada de ${document.title}`} />
                    : <FilePlus2 />}
                </button>
                <span className="page-flag">{document.pages.length} {document.pages.length === 1 ? 'pág.' : 'págs.'}</span>
                <div className="recent-meta">
                  <strong>{document.title}</strong>
                  <span>{dateLabel(document.updatedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
