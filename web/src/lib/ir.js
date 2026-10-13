import { useEffect, useRef } from 'react';

// Ir a algo concreto desde cualquier sitio (p. ej. desde «Trabajando en…»): una pieza, una sección del Laboratorio
// o un diseño. La pestaña que lo sabe abrir lo recoge cuando ya tiene sus datos (fn devuelve true si lo ha abierto).
let pendiente = null;

export function pedirIr(destino) {
  pendiente = destino;
  window.dispatchEvent(new CustomEvent('jarvis:ir'));
}

export function useIr(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const probar = () => { if (pendiente && ref.current(pendiente)) pendiente = null; };
    probar();
    window.addEventListener('jarvis:ir', probar);
    return () => window.removeEventListener('jarvis:ir', probar);
  });
}
