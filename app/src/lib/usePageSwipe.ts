import { useRef } from 'react';

type SwipeStart = { x: number; y: number; at: number; pointerId: number } | null;

export function usePageSwipe(onPrevious: () => void, onNext: () => void, enabled = true) {
  const start = useRef<SwipeStart>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!enabled || !event.isPrimary || start.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    start.current = { x: event.clientX, y: event.clientY, at: performance.now(), pointerId: event.pointerId };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // El gesto también funciona si el navegador no permite capturar este puntero.
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!enabled || !start.current || start.current.pointerId !== event.pointerId) return;
    const origin = start.current;
    start.current = null;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const elapsed = performance.now() - origin.at;
    if (elapsed > 900 || Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    if (dx > 0) onPrevious();
    else onNext();
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLElement>) => {
    if (start.current?.pointerId === event.pointerId) start.current = null;
  };

  return { onPointerDown, onPointerUp, onPointerCancel };
}
