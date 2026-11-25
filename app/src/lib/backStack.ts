// Pila de capas para el botón atrás (Android), ESC (escritorio) y el gesto del navegador.
// Cada capa devuelve true si consumió el evento.

type BackHandler = () => boolean;

const handlers: BackHandler[] = [];

export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function popBackLayer(): boolean {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  return handler() === true;
}

export function backDepth(): number {
  return handlers.length;
}
