import { useRef } from 'react';
import {
  Camera, Check, Combine, Copy, FilePlus2, Search, SortAsc, Star, Trash2, Upload, X,
} from 'lucide-react';
import type { FolioDocument } from '../types';
import BlobImage from './BlobImage';

export type LibraryFilter = 'all' | 'favorites';
export type LibrarySort = 'recent' | 'name' | 'pages';

interface Props {
  documents: FolioDocument[];
  busy: boolean;
  search: string;
  filter: LibraryFilter;
  sort: LibrarySort;
  selected: Set<string>;
  onSearch: (value: string) => void;
  onFilter: (value: LibraryFilter) => void;
  onSort: (value: LibrarySort) => void;
  onToggleSelect: (id: string) => void;
  onClearSelection: () => void;
  onOpen: (id: string) => void;
  onCamera: (preset?: 'scan' | 'id' | 'book' | 'board') => void;
  onImport: () => void;
  onDelete: (document: FolioDocument) => void;
  onDuplicate: (document: FolioDocument) => void;
  onFavorite: (document: FolioDocument) => void;
  onMerge: () => void;
}

function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(timestamp);
}

export default function Library(props: Props) {
  const {
    documents, busy, search, filter, sort, selected, onSearch, onFilter, onSort,
    onToggleSelect, onClearSelection, onOpen, onCamera, onImport,
    onDelete, onDuplicate, onFavorite, onMerge,
  } = props;
  const pageCount = documents.reduce((sum, document) => sum + document.pages.length, 0);
  const longPressTimer = useRef<number>(0);
  const longPressFired = useRef(false);

  const startLongPress = (id: string) => {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      onToggleSelect(id);
      if (typeof navigator.vibrate === 'function') navigator.vibrate(20);
    }, 450);
  };

  const cancelLongPress = () => window.clearTimeout(longPressTimer.current);

  const handleCardOpen = (id: string) => {
    if (longPressFired.current) { longPressFired.current = false; return; }
    onOpen(id);
  };

  return (
    <div className="files-pane">
      <header className="files-head">
        <h1>Todo <span>({documents.length})</span></h1>
        <div className="files-tools">
          <label className="search-box">
            <Search />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Buscar por nombre o contenido"
              aria-label="Buscar documentos"
            />
            {search && <button onClick={() => onSearch('')} aria-label="Limpiar búsqueda"><X /></button>}
          </label>
          <label className="sort-select-wrap" aria-label="Ordenar documentos">
            <SortAsc />
            <select className="sort-select" value={sort} onChange={(event) => onSort(event.target.value as LibrarySort)}>
              <option value="recent">Recientes</option>
              <option value="name">Nombre</option>
              <option value="pages">Páginas</option>
            </select>
          </label>
        </div>
        <div className="library-filter">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => onFilter('all')}>Todos</button>
          <button className={filter === 'favorites' ? 'active' : ''} onClick={() => onFilter('favorites')}><Star /> Favoritos</button>
        </div>
      </header>

      <section className="quick-cards" aria-label="Acciones de archivos">
        <button className="quick-card" onClick={onImport} disabled={busy}><Upload /><span>Importar archivos</span></button>
        <button className="quick-card" onClick={() => onCamera()} disabled={busy}><Camera /><span>Escanear ahora</span></button>
      </section>

      {selected.size > 0 && (
        <div className="selection-bar">
          <strong>{selected.size} seleccionados</strong>
          <button onClick={onMerge} disabled={selected.size < 2}><Combine /> Combinar</button>
          <button onClick={onClearSelection}><X /> Quitar selección</button>
        </div>
      )}

      {documents.length === 0 ? (
        <section className="empty-library">
          <div className="paper-mark" aria-hidden="true"><span className="paper-lines"><i /><i /><i /></span></div>
          <h2>{search || filter !== 'all' ? 'No encontramos ese documento' : 'Sin documentos todavía'}</h2>
          <p>{search || filter !== 'all'
            ? 'Prueba otra búsqueda o vuelve a mostrar todos los documentos.'
            : 'Escanea con la cámara o importa una imagen o PDF. Todo se guarda en este dispositivo.'}</p>
          {search || filter !== 'all'
            ? <button className="scan-new" onClick={() => { onSearch(''); onFilter('all'); }}>Mostrar todos</button>
            : <div className="button-row">
                <button className="scan-new" onClick={() => onCamera()} disabled={busy}><Camera /> Escanear</button>
                <button className="button secondary" onClick={onImport} disabled={busy}><Upload /> Importar</button>
              </div>}
        </section>
      ) : (
        <>
          <p className="files-count">{documents.length} {documents.length === 1 ? 'documento' : 'documentos'} · {pageCount} {pageCount === 1 ? 'página' : 'páginas'}</p>
          <section className="document-grid" aria-label="Documentos">
            {documents.map((document) => {
              const isSelected = selected.has(document.id);
              return (
                <article className={`document-card ${isSelected ? 'selected' : ''}`} key={document.id}>
                  <div className="document-preview">
                    <button
                      className="document-open"
                      onClick={() => handleCardOpen(document.id)}
                      onPointerDown={() => startLongPress(document.id)}
                      onPointerUp={cancelLongPress}
                      onPointerLeave={cancelLongPress}
                      onContextMenu={(event) => { event.preventDefault(); onToggleSelect(document.id); }}
                      aria-label={`Abrir ${document.title}`}
                    >
                      {document.pages[0] ? <BlobImage blob={document.pages[0].thumbnail} alt={`Portada de ${document.title}`} /> : <FilePlus2 />}
                    </button>
                    <label className="select-check" title="Seleccionar">
                      <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(document.id)} aria-label={`Seleccionar ${document.title}`} />
                      <span>{isSelected && <Check />}</span>
                    </label>
                    <span className="page-count">{document.pages.length} {document.pages.length === 1 ? 'pág.' : 'págs.'}</span>
                  </div>
                  <div className="document-info">
                    <button className="document-title" onClick={() => handleCardOpen(document.id)}>{document.title}</button>
                    <span>{dateLabel(document.updatedAt)} · {document.pages.filter((page) => page.ocrText).length} con OCR</span>
                    <div className="document-actions">
                      <button
                        className={document.favorite ? 'favorite active' : 'favorite'}
                        onClick={() => onFavorite(document)}
                        aria-label={document.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                      ><Star /></button>
                      <button onClick={() => onDuplicate(document)} aria-label="Duplicar documento"><Copy /></button>
                      <button onClick={() => onDelete(document)} aria-label="Eliminar documento"><Trash2 /></button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}

    </div>
  );
}
