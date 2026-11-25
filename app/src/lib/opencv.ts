import openCvScriptUrl from '@techstark/opencv-js/dist/opencv.js?url';

export type OpenCv = import('@techstark/opencv-js').CV;

type OpenCvRuntime = OpenCv & {
  ready?: Promise<void>;
  onRuntimeInitialized?: () => void;
};

declare global {
  interface Window {
    cv?: OpenCvRuntime | Promise<OpenCvRuntime>;
  }
}

let loading: Promise<OpenCv> | undefined;

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-folio-opencv]');
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    const script = existing ?? document.createElement('script');
    script.dataset.folioOpencv = 'true';
    script.async = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('No se pudo cargar OpenCV desde los recursos locales')), { once: true });
    if (!existing) {
      script.src = openCvScriptUrl;
      document.head.appendChild(script);
    }
  });
}

async function initialize(): Promise<OpenCv> {
  await loadScript();
  if (!window.cv) throw new Error('OpenCV no quedó disponible');
  const candidate = await Promise.resolve(window.cv);
  if (candidate.Mat) return candidate;
  if (candidate.ready) {
    await candidate.ready;
    return candidate;
  }
  // El runtime puede inicializarse antes de que asignemos el callback: si el
  // evento ya pasó, esperar el callback colgaría la app para siempre. Sondear
  // evita esa carrera (falla pasada reportada como "Preparando páginas" eterno).
  for (let attempts = 0; attempts < 600; attempts += 1) {
    if (candidate.Mat) return candidate;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('OpenCV no terminó de inicializar');
}

export function getOpenCv(): Promise<OpenCv> {
  loading ??= initialize().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
