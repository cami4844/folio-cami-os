import { useEffect, useState } from 'react';
import { Check, ScanLine, X } from 'lucide-react';
import type { PageRecord, Quad } from '../types';
import { quadGeometryError } from '../lib/quadGeometry';
import { useBlobUrl } from './BlobImage';
import QuadEditor from './QuadEditor';

interface Props {
  page: PageRecord;
  busy: boolean;
  onApply: (quad: Quad) => void;
  onAuto: () => Promise<Quad | null>;
  onCancel: () => void;
}

export default function CropEditor({ page, busy, onApply, onAuto, onCancel }: Props) {
  const url = useBlobUrl(page.original);
  const [quad, setQuad] = useState<Quad>(page.quad.map((point) => ({ ...point })) as Quad);
  const [geometryError, setGeometryError] = useState('');

  useEffect(() => {
    setQuad(page.quad.map((point) => ({ ...point })) as Quad);
  }, [page.id, page.quad]);

  return (
    <div className="crop-editor">
      {url ? (
        <QuadEditor src={url} quad={quad} onChange={(next) => { setGeometryError(''); setQuad(next); }} disabled={busy} label="Recorte manual de la página" />
      ) : (
        <div className="crop-loading" role="status">Abriendo imagen…</div>
      )}
      {geometryError && <p className="geometry-error" role="alert">{geometryError}</p>}
      <div className="crop-actions">
        <button className="button ghost" onClick={onCancel} disabled={busy}><X /> Cancelar</button>
        <button className="button secondary" onClick={() => void onAuto().then((found) => { if (found) setQuad(found); }).catch(() => setGeometryError('No pudimos detectar los bordes. Ajusta los puntos manualmente.'))} disabled={busy}><ScanLine /> Detectar bordes</button>
        <button className="button primary" onClick={() => {
          const issue = quadGeometryError(quad);
          if (issue) { setGeometryError(issue); return; }
          onApply(quad);
        }} disabled={busy || !url}><Check /> Aplicar recorte</button>
      </div>
    </div>
  );
}
