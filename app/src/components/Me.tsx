import { Check, Info, Moon, ShieldCheck, Sun } from 'lucide-react';
import type { FolioDocument, ThemeChoice } from '../types';
import { isNativeApp } from '../lib/camera';
import Logo from './Logo';

interface Props {
  documents: FolioDocument[];
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
}

export default function Me({ documents, theme, onTheme }: Props) {
  const pages = documents.reduce((sum, document) => sum + document.pages.length, 0);
  const platform = isNativeApp() ? 'Android' : window.folioDesktop ? 'Windows' : 'Navegador';

  return (
    <div className="me-pane">
      <section className="me-brand">
        <Logo />
        <p className="me-tagline">Escáner local completo para tu celular y tu PC. Sin cuentas, sin anuncios, sin nube obligatoria.</p>
        <span className="me-os">Powered by Cami-OS</span>
      </section>

      <section className="me-card" aria-label="Apariencia">
        <h3>Apariencia</h3>
        <div className="theme-options">
          {([['system', 'Automático', Info], ['light', 'Claro', Sun], ['dark', 'Oscuro', Moon]] as const).map(([value, label, Icon]) => (
            <button key={value} className={theme === value ? 'active' : ''} onClick={() => onTheme(value)}>
              <Icon /><span>{label}</span>{theme === value && <Check />}
            </button>
          ))}
        </div>
      </section>

      <section className="me-card" aria-label="Tu biblioteca">
        <h3>Tu biblioteca</h3>
        <dl className="me-facts">
          <div><span>Documentos</span><strong>{documents.length}</strong></div>
          <div><span>Páginas escaneadas</span><strong>{pages}</strong></div>
          <div><span>Idiomas OCR</span><strong>Español + English</strong></div>
          <div><span>Plataforma</span><strong>{platform}</strong></div>
        </dl>
      </section>

      <section className="me-card privacy" aria-label="Privacidad">
        <ShieldCheck />
        <div>
          <h3>Privacidad local</h3>
          <p>Los documentos, imágenes y el texto OCR se guardan en IndexedDB dentro de este dispositivo. Folio no usa cuentas, ni anuncios, ni analítica, y no envía nada a internet.</p>
        </div>
      </section>

      <p className="me-note">Al desinstalar la app o borrar los datos también se elimina la biblioteca: exporta tus PDF importantes.</p>
      <footer className="me-footer">Folio v0.2.0 · Local por diseño</footer>
    </div>
  );
}
