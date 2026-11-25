import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen, Camera, Check, FolderUp, Grid3x3, LayoutGrid, MoreVertical, ScanLine,
  Settings2, SquareSlash, UserSquare2, X, Zap, ZapOff,
} from 'lucide-react';
import { App as CapacitorApp } from '@capacitor/app';
import { pushBackHandler } from '../lib/backStack';
import { readSetting, saveSetting } from '../lib/db';
import { analyzeLiveQuad, canvasToBlob, type DocumentDetection } from '../lib/image';
import { nativeTorchAvailable, onNativeTorchChanged, setNativeTorch } from '../lib/nativeTorch';
import type { Quad } from '../types';
import CaptureReview from './CaptureReview';

export type CameraPreset = 'scan' | 'id' | 'book' | 'board';

export interface ScanShot { blob: Blob; quad?: Quad; label?: string }

interface Props {
  initialPreset: CameraPreset;
  onDone: (shots: ScanShot[], preset: CameraPreset) => void;
  onClose: () => void;
  onImport: () => void;
  onNativeFallback: () => Promise<Blob | null>;
}

const MODES: { key: CameraPreset; label: string; icon: typeof Camera }[] = [
  { key: 'scan', label: 'Escanear', icon: ScanLine },
  { key: 'id', label: 'Documento ID', icon: UserSquare2 },
  { key: 'book', label: 'Libro', icon: BookOpen },
  { key: 'board', label: 'Pizarra', icon: SquareSlash },
];

const AUTO_CAPTURE_STABLE_FRAMES = 5;
const AUTO_CAPTURE_MIN_STABLE_MS = 850;

interface ReviewState { blob: Blob; quad: Quad | null; kind: 'scan' | 'card' | 'book'; confirmLabel: string }

export default function CameraDialog({ initialPreset, onDone, onClose, onImport, onNativeFallback }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchBase = useRef<{ distance: number; zoom: number } | null>(null);
  const stableCount = useRef(0);
  const stableSince = useRef(0);
  const lastCoverage = useRef(0);
  const lastQuad = useRef<Quad | null>(null);
  const displayedQuad = useRef<Quad | null>(null);
  const capturing = useRef(false);
  const cameraGeneration = useRef(0);
  const cameraPaused = useRef(false);
  const torchChanging = useRef(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [cameraNonce, setCameraNonce] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<CameraPreset>(initialPreset);
  const [batchMode, setBatchMode] = useState(false);
  const [batch, setBatch] = useState<ScanShot[]>([]);
  const [torchable, setTorchable] = useState(false);
  const [flash, setFlash] = useState(false);
  const [grid, setGrid] = useState(true);
  const [liveDetect, setLiveDetect] = useState(true);
  const [autoCapture, setAutoCapture] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [trackZoomRange, setTrackZoomRange] = useState<{ min: number; max: number } | null>(null);
  const zoomRequest = useRef(1);
  const zoomQueue = useRef(Promise.resolve());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showZoomChip, setShowZoomChip] = useState(false);
  const [liveQuad, setLiveQuad] = useState<Quad | null>(null);
  const [detection, setDetection] = useState<DocumentDetection | null>(null);
  const [stability, setStability] = useState(0);
  const [videoRect, setVideoRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [review, setReview] = useState<ReviewState | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [idStage, setIdStage] = useState<'front' | 'back'>('front');
  const [frontShot, setFrontShot] = useState<ScanShot | null>(null);
  const [hint, setHint] = useState('');
  const [detectReady, setDetectReady] = useState(false);
  const [lastShot, setLastShot] = useState('');

  useEffect(() => () => {
    if (lastShot) URL.revokeObjectURL(lastShot);
  }, [lastShot]);

  // Ajustes de cámara persistentes (se cargan una vez y se guardan al cambiar).
  useEffect(() => {
    void readSetting<{ version?: number; autoCapture: boolean; liveDetect: boolean; haptics: boolean; grid: boolean; batchMode: boolean } | undefined>('camera', undefined).then((stored) => {
      if (!stored) return;
      // v0.5 activa una vez el nuevo motor; después respeta la elección del usuario.
      if (stored.version !== 2) setAutoCapture(true);
      else if (typeof stored.autoCapture === 'boolean') setAutoCapture(stored.autoCapture);
      if (typeof stored.liveDetect === 'boolean') setLiveDetect(stored.liveDetect);
      if (typeof stored.haptics === 'boolean') setHaptics(stored.haptics);
      if (typeof stored.grid === 'boolean') setGrid(stored.grid);
      if (typeof stored.batchMode === 'boolean') setBatchMode(stored.batchMode);
    }).catch(() => undefined).finally(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    void saveSetting('camera', { version: 2, autoCapture, liveDetect, haptics, grid, batchMode }).catch(() => undefined);
  }, [settingsLoaded, autoCapture, liveDetect, haptics, grid, batchMode]);

  const updateVideoRect = useCallback(() => {
    const source = video.current;
    const container = stage.current;
    if (!source?.videoWidth || !container) return;
    const scale = Math.min(container.clientWidth / source.videoWidth, container.clientHeight / source.videoHeight);
    const width = source.videoWidth * scale;
    const height = source.videoHeight * scale;
    setVideoRect({
      left: (container.clientWidth - width) / 2,
      top: (container.clientHeight - height) / 2,
      width,
      height,
    });
  }, []);

  useEffect(() => {
    if (!ready || !stage.current) return;
    const observer = new ResizeObserver(updateVideoRect);
    observer.observe(stage.current);
    updateVideoRect();
    return () => observer.disconnect();
  }, [ready, updateVideoRect]);

  const stop = useCallback(() => {
    const track = stream.current?.getVideoTracks()[0];
    if (track) {
      const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() as { torch?: boolean } : undefined;
      if (capabilities?.torch) {
        void track.applyConstraints({ advanced: [{ torch: false } as unknown as MediaTrackConstraintSet] } as MediaTrackConstraints).catch(() => undefined);
      }
    }
    void setNativeTorch(false);
    stream.current?.getTracks().forEach((item) => item.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    let mounted = true;
    const generation = ++cameraGeneration.current;
    setReady(false);
    setError('');
    setFlash(false);
    setTorchable(false);
    setTrackZoomRange(null);
    setZoom(1);
    stop();
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false,
    }).then((next) => {
      if (!mounted || cameraPaused.current || generation !== cameraGeneration.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = next;
      const track = next.getVideoTracks()[0];
      const capabilities = typeof track?.getCapabilities === 'function' ? track.getCapabilities() : undefined;
      const browserTorch = Boolean((capabilities as { torch?: boolean } | undefined)?.torch);
      const zoomCapabilities = (capabilities as { zoom?: { min: number; max: number } } | undefined)?.zoom;
      setTrackZoomRange(zoomCapabilities && zoomCapabilities.max > zoomCapabilities.min ? zoomCapabilities : null);
      setTorchable(browserTorch);
      if (!browserTorch) {
        void nativeTorchAvailable().then((available) => {
          if (mounted && !cameraPaused.current && generation === cameraGeneration.current && available) setTorchable(true);
        });
      }
      if (video.current) {
        video.current.srcObject = next;
        void video.current.play();
      }
    }).catch((reason: unknown) => {
      if (mounted && !cameraPaused.current && generation === cameraGeneration.current) setError(reason instanceof Error ? reason.message : 'No se pudo abrir la cámara');
    });
    return () => {
      mounted = false;
      cameraGeneration.current += 1;
      stop();
    };
  }, [facing, stop, cameraNonce]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void onNativeTorchChanged((enabled) => {
      if (mounted) setFlash(enabled);
    }).then((cleanup) => { unsubscribe = cleanup; });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let pauseSubscription: { remove: () => void } | undefined;
    let resumeSubscription: { remove: () => void } | undefined;
    const onPause = () => {
      cameraPaused.current = true;
      cameraGeneration.current += 1;
      stop();
      setReady(false);
    };
    const onResume = () => {
      cameraPaused.current = false;
      setCameraNonce((value) => value + 1);
    };
    void CapacitorApp.addListener('pause', onPause).then((listener) => { pauseSubscription = listener; });
    void CapacitorApp.addListener('resume', onResume).then((listener) => { resumeSubscription = listener; });
    return () => {
      pauseSubscription?.remove();
      resumeSubscription?.remove();
    };
  }, [stop]);

  // Precarga de OpenCV para detección en vivo (el hint avisa mientras carga).
  useEffect(() => {
    let cancelled = false;
    void import('../lib/opencv').then(async ({ getOpenCv }) => {
      try {
        await getOpenCv();
        if (!cancelled) setDetectReady(true);
      } catch {
        if (!cancelled) setDetectReady(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Una pasada cada vez: nunca se acumulan OpenCV WASM ni conteos de fotogramas viejos.
  useEffect(() => {
    if (!ready || !detectReady || !liveDetect || review || mode !== 'scan') {
      setLiveQuad(null);
      displayedQuad.current = null;
      setDetection(null);
      setStability(0);
      stableCount.current = 0;
      lastQuad.current = null;
      return;
    }
    let cancelled = false;
    let timer = 0;
    const resetStability = () => {
      stableCount.current = 0;
      stableSince.current = 0;
      setStability(0);
    };
    const tick = async () => {
      if (cancelled || !video.current) return;
      try {
        const found = await analyzeLiveQuad(video.current, captureCrop);
        if (cancelled) return;
        setDetection(found);
        if (!found) {
          setLiveQuad(null);
          displayedQuad.current = null;
          lastQuad.current = null;
          lastCoverage.current = 0;
          resetStability();
          return;
        }

        const previous = lastQuad.current;
        const moved = previous
          ? Math.max(...found.quad.map((point, index) => Math.hypot(point.x - previous[index].x, point.y - previous[index].y)))
          : 1;
        const display = previous && moved < 0.08
          ? found.quad.map((point, index) => ({
              x: previous[index].x * 0.35 + point.x * 0.65,
              y: previous[index].y * 0.35 + point.y * 0.65,
            })) as Quad
          : found.quad;
        displayedQuad.current = display;
        setLiveQuad(display);

        const fullyVisible = found.quad.every((point) => point.x > 0.008 && point.x < 0.992 && point.y > 0.008 && point.y < 0.992);
        const usable = found.coverage >= 0.12 && found.coverage <= 0.94
          && found.confidence >= 0.44 && found.sideSupport >= 0.34
          && found.sharpness >= 18 && found.brightness >= 28 && found.brightness <= 246
          && fullyVisible;
        const grew = lastCoverage.current > 0 && found.coverage > lastCoverage.current * 1.08;

        if (autoCapture && usable && !grew && moved < 0.022 && !capturing.current) {
          if (stableCount.current === 0) stableSince.current = Date.now();
          stableCount.current += 1;
          const progress = Math.min(1, stableCount.current / AUTO_CAPTURE_STABLE_FRAMES);
          setStability(progress);
          if (stableCount.current >= AUTO_CAPTURE_STABLE_FRAMES && Date.now() - stableSince.current >= AUTO_CAPTURE_MIN_STABLE_MS) {
            resetStability();
            void shoot(true);
            return;
          }
        } else {
          resetStability();
        }
        lastQuad.current = found.quad;
        lastCoverage.current = found.coverage;
      } catch {
        if (!cancelled) resetStability();
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void tick(), 280);
      }
    };
    timer = window.setTimeout(() => void tick(), 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, detectReady, liveDetect, review, mode, autoCapture, zoom, trackZoomRange]);

  // Capa de atrás interna: primero la revisión, luego los paneles, luego cerrar sesión.
  useEffect(() => pushBackHandler(() => {
    if (review) {
      setReview(null);
      return true;
    }
    if (settingsOpen) { setSettingsOpen(false); return true; }
    if (toolsOpen) { setToolsOpen(false); return true; }
    if (batch.length > 0 || frontShot) { requestClose(); return true; }
    return false;
  }), [review, settingsOpen, toolsOpen, batch.length, frontShot]);

  const showHint = (message: string) => {
    setHint(message);
    window.setTimeout(() => setHint((current) => current === message ? '' : current), 2600);
  };

  const applyTorch = async (target: boolean) => {
    if (torchChanging.current) return;
    torchChanging.current = true;
    try {
      let applied = false;
      const track = stream.current?.getVideoTracks()[0];
      const capabilities = track && typeof track.getCapabilities === 'function'
        ? track.getCapabilities() as { torch?: boolean }
        : undefined;
      if (track && capabilities?.torch) {
        try {
          await track.applyConstraints({ advanced: [{ torch: target } as unknown as MediaTrackConstraintSet] } as MediaTrackConstraints);
          const actual = (track.getSettings() as { torch?: boolean }).torch;
          applied = actual === undefined ? true : actual === target;
        } catch {
          applied = false;
        }
      }
      if (!applied) applied = await setNativeTorch(target);
      if (applied) {
        setFlash(target);
        setTorchable(true);
      } else {
        showHint('El sistema no confirmó el cambio de flash. La cámara sigue disponible.');
      }
    } finally {
      torchChanging.current = false;
    }
  };

  const toggleTorch = () => {
    if (!torchable) {
      showHint('Este dispositivo no permite controlar el flash desde la app');
      return;
    }
    void applyTorch(!flash);
  };

  const vibrate = () => {
    if (haptics && typeof navigator.vibrate === 'function') navigator.vibrate(30);
  };

  const previewScale = trackZoomRange ? 1 : zoom;
  const captureCrop = trackZoomRange ? null : {
    x: (1 - 1 / zoom) / 2,
    y: (1 - 1 / zoom) / 2,
    width: 1 / zoom,
    height: 1 / zoom,
  };

  const shoot = async (auto = false) => {
    const source = video.current;
    if (!source?.videoWidth || capturing.current) return;
    capturing.current = true;
    const shotQuad = displayedQuad.current?.map((point) => ({ ...point })) as Quad | undefined;
    try {
      const canvas = document.createElement('canvas');
      const sx = (captureCrop?.x ?? 0) * source.videoWidth;
      const sy = (captureCrop?.y ?? 0) * source.videoHeight;
      const sw = (captureCrop?.width ?? 1) * source.videoWidth;
      const sh = (captureCrop?.height ?? 1) * source.videoHeight;
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
      setLastShot(URL.createObjectURL(blob));
      vibrate();
      if (flash) void applyTorch(false);
      if (mode === 'book') {
        setReview({ blob, quad: null, kind: 'book', confirmLabel: 'Crear 2 páginas' });
      } else if (mode === 'id') {
        setReview({ blob, quad: null, kind: 'card', confirmLabel: idStage === 'front' ? 'Continuar al reverso' : 'Guardar reverso' });
      } else {
        // El polígono revisado es el mismo que estaba dibujado al congelar el fotograma.
        setReview({ blob, quad: shotQuad ?? null, kind: 'scan', confirmLabel: 'Siguiente' });
      }
      void auto;
    } finally {
      capturing.current = false;
    }
  };

  const useSystemCamera = async () => {
    try {
      const blob = await onNativeFallback();
      if (!blob) {
        setError('La cámara del sistema no devolvió una imagen');
        return;
      }
      const kind: ReviewState['kind'] = mode === 'book' ? 'book' : mode === 'id' ? 'card' : 'scan';
      const confirmLabel = kind === 'book' ? 'Crear 2 páginas' : kind === 'card' ? (idStage === 'front' ? 'Continuar al reverso' : 'Guardar reverso') : 'Siguiente';
      setReview({ blob, quad: null, kind, confirmLabel });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo usar la cámara del sistema');
    }
  };

  const acceptShot = (quad: Quad, splitCenter: number | null) => {
    if (!review) return;
    const shot: ScanShot = { blob: review.blob, quad };
    if (mode === 'id') {
      if (idStage === 'front') {
        setFrontShot({ ...shot, label: 'Anverso' });
        setReview(null);
        setIdStage('back');
        showHint('Gira la tarjeta y captura el reverso');
        return;
      }
      const shots = frontShot ? [frontShot, { ...shot, label: 'Reverso' }] : [{ ...shot, label: 'Reverso' }];
      onDone(shots, 'id');
      return;
    }
    if (mode === 'book') {
      if (splitCenter !== null) {
        const t = splitCenter;
        const lerp = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        const top = lerp(quad[0], quad[1]);
        const bottom = lerp(quad[3], quad[2]);
        onDone([
          { blob: review.blob, quad: [quad[0], top, bottom, quad[3]], label: 'Página izquierda' },
          { blob: review.blob, quad: [top, quad[1], quad[2], bottom], label: 'Página derecha' },
        ], 'book');
      } else {
        onDone([{ ...shot, label: 'Página' }], 'book');
      }
      return;
    }
    const nextBatch = [...batch, shot];
    setBatch(nextBatch);
    setReview(null);
    if (!batchMode) {
      onDone(nextBatch, mode);
      return;
    }
    showHint(`${nextBatch.length} ${nextBatch.length === 1 ? 'página lista' : 'páginas listas'} en el lote`);
  };

  const finishBatch = () => {
    if (mode === 'scan' && batch.length) onDone(batch, mode);
  };

  const changeMode = (next: CameraPreset) => {
    if (next !== 'scan' && batchMode && batch.length > 0) {
      showHint('Pulsa Listo para terminar el lote antes de cambiar de modo');
      return;
    }
    setMode(next);
    if (next !== 'scan') setBatchMode(false);
  };

  const requestClose = () => {
    if (batch.length > 0 || frontShot || review) {
      const discard = window.confirm('¿Salir y descartar el trabajo de esta sesión de cámara?');
      if (!discard) return;
    }
    onClose();
  };

  const requestImport = () => {
    if ((batch.length > 0 || frontShot || review) && !window.confirm('Importar cerrará esta sesión al recibir archivos. Si cancelas el selector, tu trabajo seguirá abierto. ¿Continuar?')) return;
    onImport();
  };

  // Una sola ampliación efectiva: track si existe; recorte digital equivalente si no.
  const applyZoom = (value: number) => {
    zoomRequest.current = value;
    if (!trackZoomRange) return;
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const mapped = trackZoomRange.min + (value - 1) / 3 * (trackZoomRange.max - trackZoomRange.min);
    zoomQueue.current = zoomQueue.current.then(async () => {
      if (zoomRequest.current !== value) return;
      await track.applyConstraints({ advanced: [{ zoom: mapped } as unknown as MediaTrackConstraintSet] } as MediaTrackConstraints);
    }).catch(() => {
      if (zoomRequest.current === value) setTrackZoomRange(null);
    });
  };

  const onStagePointerDown = (event: React.PointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchBase.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };

  const onStagePointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinchBase.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = distance / Math.max(1, pinchBase.current.distance);
      const next = Math.max(1, Math.min(4, pinchBase.current.zoom * ratio));
      setZoom(next);
      setShowZoomChip(true);
      applyZoom(next);
    }
  };

  const onStagePointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) {
      pinchBase.current = null;
      window.setTimeout(() => setShowZoomChip(false), 900);
    }
  };

  const reviewGuide = review?.kind === 'card';
  const fullyVisibleLive = liveQuad?.every((point) => point.x > 0.008 && point.x < 0.992 && point.y > 0.008 && point.y < 0.992) ?? false;
  let scanStatus = '';
  if (mode === 'scan' && liveDetect && !review) {
    if (!detectReady) scanStatus = 'Preparando detección de bordes…';
    else if (!detection || !liveQuad) scanStatus = 'Muestra la hoja completa dentro del marco';
    else if (detection.coverage < 0.12) scanStatus = 'Acerca la hoja para ver mejor sus bordes';
    else if (detection.coverage > 0.94 || !fullyVisibleLive) scanStatus = 'Aleja un poco: deben verse las 4 esquinas';
    else if (detection.brightness < 28 || detection.brightness > 246) scanStatus = 'Busca una luz más pareja, sin quemar el papel';
    else if (detection.sharpness < 18) scanStatus = 'Sostén firme para enfocar la hoja…';
    else if (detection.confidence < 0.44 || detection.sideSupport < 0.34) scanStatus = 'Buscando los cuatro bordes de la hoja…';
    else if (autoCapture) scanStatus = stability > 0 ? `Hoja completa · no muevas ${Math.round(stability * 100)} %` : 'Hoja detectada · sostén firme';
    else scanStatus = 'Hoja completa detectada';
  }

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Cámara de Folio">
      <header className="scanner-top">
        <button className="scan-icon" onClick={requestClose} aria-label="Cerrar cámara"><X /></button>
        <span className="hd-badge">HD</span>
        <button
          className={`scan-icon ${flash ? 'on' : ''}`}
          onClick={toggleTorch}
          aria-label={flash ? 'Apagar flash' : 'Encender flash'}
        >{flash ? <Zap /> : <ZapOff />}</button>
        <button className={`scan-icon ${grid ? 'on' : ''}`} onClick={() => setGrid((value) => !value)} aria-label="Cuadrícula"><Grid3x3 /></button>
        <button className="scan-icon" onClick={() => setSettingsOpen(true)} aria-label="Ajustes de la cámara"><MoreVertical /></button>
      </header>

      {review ? (
        <div className="review-wrap">
          <CaptureReview
            blob={review.blob}
            initialQuad={review.quad}
            busy={false}
            variant={review.kind}
            confirmLabel={review.confirmLabel}
            onConfirm={acceptShot}
            onRetake={() => setReview(null)}
          />
        </div>
      ) : (
        <>
          <div
            className="scanner-stage"
            ref={stage}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={onStagePointerUp}
          >
            <video ref={video} muted playsInline onLoadedMetadata={() => { setReady(true); updateVideoRect(); }} onCanPlay={() => { setReady(true); updateVideoRect(); }} style={{ transform: `scale(${previewScale})` }} />
            {mode === 'scan' && (
              <button
                className={`auto-capture-chip ${autoCapture ? 'active' : ''}`}
                onClick={() => setAutoCapture((value) => !value)}
                aria-pressed={autoCapture}
                aria-label="Auto-captura"
              ><ScanLine /> Auto {autoCapture ? 'activada' : 'apagada'}</button>
            )}
            <div className="viewfinder-corners" aria-hidden="true"><i /><i /><i /><i /></div>
            {grid && <div className="scan-grid" aria-hidden="true"><span /><span /></div>}
            {mode === 'id' && <div className="id-guide" aria-hidden="true" />}
            {mode === 'scan' && liveQuad && (
              <svg
                className={`live-quad ${stability > 0 ? 'locked' : ''}`}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Documento detectado"
                style={{
                  left: videoRect.left,
                  top: videoRect.top,
                  width: videoRect.width,
                  height: videoRect.height,
                  transform: `scale(${zoom})`,
                }}
              >
                <polygon points={liveQuad.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')} />
                {liveQuad.map((point, index) => <circle key={index} cx={point.x * 100} cy={point.y * 100} r="1.6" />)}
              </svg>
            )}
            {mode === 'board' && <div className="preset-hint">La captura sale en blanco y negro limpio</div>}
            {mode === 'id' && idStage === 'back' && <div className="preset-hint strong">Gira la tarjeta y captura el reverso</div>}
            {scanStatus && (
              <div className={`detection-status ${stability > 0 ? 'locking' : ''}`} role="status">
                <span>{scanStatus}</span>
                {autoCapture && stability > 0 && <div className="auto-progress"><i style={{ width: `${stability * 100}%` }} /></div>}
              </div>
            )}
            {showZoomChip && <div className="zoom-chip">{zoom.toFixed(1)}x</div>}
            {lastShot && <img className="last-shot" src={lastShot} alt="Última captura" />}
            {!ready && !error && <div className="camera-message">Abriendo cámara…</div>}
            {error && (
              <div className="camera-message error-box">
                <strong>No hay acceso a la cámara</strong>
                <p>{error}</p>
                <div className="button-row">
                  <button className="scan-new" onClick={() => void useSystemCamera()}>Usar cámara del sistema</button>
                  <button className="button secondary" onClick={requestImport}>Importar archivos</button>
                </div>
              </div>
            )}
            {hint && <div className="camera-toast">{hint}</div>}
          </div>

          {mode === 'scan' && (
            <div className="mode-pill" role="tablist" aria-label="Modo de captura">
              <button className={!batchMode ? 'active' : ''} onClick={() => setBatchMode(false)} role="tab" aria-selected={!batchMode}>Individual</button>
              <button className={batchMode ? 'active' : ''} onClick={() => setBatchMode(true)} role="tab" aria-selected={batchMode}>Lote</button>
            </div>
          )}

          <nav className="mode-strip" aria-label="Modos de escaneo">
            {MODES.map((item) => (
              <button
                key={item.key}
                className={`mode-chip ${mode === item.key ? 'active' : ''}`}
                onClick={() => changeMode(item.key)}
              >
                <item.icon />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <footer className="scanner-bar">
            <button className="scan-slot" onClick={() => setToolsOpen(true)} aria-label="Herramientas de captura">
              <span className="scan-slot-icon"><LayoutGrid /></span>
              <span>Herramientas</span>
            </button>
            <div className="shutter-wrap">
              {mode === 'scan' && batchMode && batch.length > 0 && (
                <button className="batch-done" onClick={finishBatch}><Check /> Listo ({batch.length})</button>
              )}
              <button className="shutter" onClick={() => void shoot()} disabled={!ready} aria-label="Capturar página" />
            </div>
            <div className="import-stack">
              <button className="scan-slot" onClick={requestImport} aria-label="Importar archivos">
                <span className="scan-slot-icon"><FolderUp /></span>
                <span>Importar</span>
              </button>
            </div>
          </footer>
        </>
      )}

      {toolsOpen && (
        <div className="tools-sheet" role="dialog" aria-label="Herramientas de captura">
          <header><h2>Herramientas</h2><button className="scan-icon" onClick={() => setToolsOpen(false)} aria-label="Cerrar herramientas"><X /></button></header>
          <h3>Modos de captura</h3>
          <div className="sheet-grid">
            {MODES.map((item) => (
              <button
                key={item.key}
                className={`sheet-tile ${mode === item.key ? 'active' : ''}`}
                onClick={() => { changeMode(item.key); setToolsOpen(false); }}
              >
                <span className="quick-icon"><item.icon /></span>
                <span className="quick-label">{item.label}</span>
              </button>
            ))}
            <button className="sheet-tile" onClick={() => { setBatchMode((value) => !value); setToolsOpen(false); }}>
              <span className="quick-icon"><Camera /></span>
              <span className="quick-label">Modo {batchMode ? 'individual' : 'lote'}</span>
            </button>
          </div>
          <p className="sheet-note">Documento ID guarda anverso y reverso en un solo documento. Libro divide el pliego en dos páginas.</p>
        </div>
      )}

      {settingsOpen && (
        <div className="tools-sheet" role="dialog" aria-label="Ajustes de la cámara">
          <header><h2>Ajustes de la cámara</h2><button className="scan-icon" onClick={() => setSettingsOpen(false)} aria-label="Cerrar ajustes"><X /></button></header>
          <h3>Comportamiento</h3>
          <div className="settings-toggles">
            <label><input type="checkbox" checked={autoCapture} onChange={(event) => setAutoCapture(event.target.checked)} /><Settings2 /> Auto-captura cuando la hoja esté estable <span>(modo Escanear)</span></label>
            <label><input type="checkbox" checked={liveDetect} onChange={(event) => setLiveDetect(event.target.checked)} /><ScanLine /> Detección de bordes en vivo</label>
            <label><input type="checkbox" checked={haptics} onChange={(event) => setHaptics(event.target.checked)} /><Zap /> Vibración al capturar</label>
            <label><input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} /><Grid3x3 /> Cuadrícula guía</label>
          </div>
          <p className="sheet-note">Estos ajustes se recuerdan para tus próximas sesiones de escaneo.</p>
        </div>
      )}
    </div>
  );
}
