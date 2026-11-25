import {
  Camera, Combine, Copy, FileDown, FileSpreadsheet, FileText, FolderUp, Languages, LayoutList,
  MoveVertical, ScanText, SquareSlash, UserSquare2,
} from 'lucide-react';

type PickPurpose = 'pdf' | 'ocr' | 'text' | 'word' | 'excel' | 'edit' | 'translate' | 'duplicate';

interface Props {
  busy: boolean;
  onCamera: (preset?: 'scan' | 'id' | 'book' | 'board') => void;
  onImport: () => void;
  onPickFor: (purpose: PickPurpose) => void;
  onMerge: () => void;
}

type Tool = { key: string; label: string; icon: typeof Camera; action?: () => void; note?: string };

export default function Tools({ busy, onCamera, onImport, onPickFor, onMerge }: Props) {
  const sections: { title: string; items: Tool[] }[] = [
    {
      title: 'Escanear',
      items: [
        { key: 'scan', label: 'Escanear', icon: Camera, action: () => onCamera() },
        { key: 'id', label: 'Documento ID', icon: UserSquare2, action: () => onCamera('id') },
        { key: 'board', label: 'Pizarra', icon: SquareSlash, action: () => onCamera('board') },
      ],
    },
    {
      title: 'Importar',
      items: [
        { key: 'import', label: 'Importar archivos', icon: FolderUp, action: onImport },
      ],
    },
    {
      title: 'Convertir',
      items: [
        { key: 'pdf', label: 'A PDF', icon: FileDown, action: () => onPickFor('pdf') },
        { key: 'word', label: 'A Word editable', icon: FileText, action: () => onPickFor('word') },
        { key: 'excel', label: 'A Excel', icon: FileSpreadsheet, action: () => onPickFor('excel') },
        { key: 'ocr', label: 'Sacar texto', icon: ScanText, action: () => onPickFor('ocr') },
        { key: 'txt', label: 'Archivo de texto', icon: FileText, action: () => onPickFor('text') },
        { key: 'translate', label: 'Traducir', icon: Languages, action: () => onPickFor('translate') },
      ],
    },
    {
      title: 'Editar',
      items: [
        { key: 'edit', label: 'Reordenar y editar', icon: LayoutList, action: () => onPickFor('edit') },
        { key: 'merge', label: 'Combinar documentos', icon: Combine, action: onMerge },
        { key: 'dup', label: 'Duplicar documento', icon: Copy, action: () => onPickFor('duplicate') },
        { key: 'move', label: 'Mover páginas', icon: MoveVertical, action: () => onPickFor('edit') },
      ],
    },
  ];

  return (
    <div className="tools-pane">
      {sections.map((section) => (
        <section key={section.title} className="tools-section" aria-label={section.title}>
          <h3>{section.title}</h3>
          <div className="tools-grid">
            {section.items.map((item) => {
              const disabled = busy || !item.action;
              return (
                <button
                  key={item.key}
                  className={`tool-tile ${item.action ? '' : 'soon'}`}
                  onClick={item.action}
                  disabled={disabled}
                  title={item.action ? item.label : `${item.label} · próximamente`}
                >
                  <span className="quick-icon">{item.action ? <item.icon /> : <SquareSlash />}</span>
                  <span className="quick-label">{item.label}</span>
                  {!item.action && <span className="soon-flag">Próximamente</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <p className="tools-note">Todo funciona en tu dispositivo: cámara, OCR, PDF y organización. Nada sale de aquí.</p>
    </div>
  );
}
