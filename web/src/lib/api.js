import { useCallback, useEffect, useRef, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

// Avisos en tiempo real: el servidor emite "cambio" cuando algo se guarda (dashboard, Hermes o Claude Code).
const oyentes = new Set();
const oyentesTipo = new Map(); // type → Set(fn)
let ws;
function conectar() {
  if (ws && ws.readyState <= 1) return;
  try {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'cambio') oyentes.forEach((f) => f());
      oyentesTipo.get(m.type)?.forEach((f) => f(m));
    };
    ws.onclose = () => setTimeout(conectar, 3000);
  } catch { /* sin WebSocket: queda el refresco periódico */ }
}

// Los avisos de cambio llegan a ráfagas (p. ej. mientras se exporta un diseño): se juntan en uno cada medio segundo
// para no pedir lo mismo diez veces seguidas. Con la pestaña en segundo plano no se pide nada: al volver, se pone al día.
export function useCambios(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    conectar();
    let reloj = null;
    let pendiente = false;
    const ya = () => { reloj = null; if (document.hidden) { pendiente = true; return; } ref.current(); };
    const f = () => { if (!reloj) reloj = setTimeout(ya, 500); };
    const alVolver = () => { if (!document.hidden && pendiente) { pendiente = false; f(); } };
    oyentes.add(f);
    window.addEventListener('focus', f);
    document.addEventListener('visibilitychange', alVolver);
    const id = setInterval(f, 30000);
    return () => { oyentes.delete(f); window.removeEventListener('focus', f); document.removeEventListener('visibilitychange', alVolver); clearInterval(id); clearTimeout(reloj); };
  }, []);
}

// Mensajes en tiempo real de un tipo concreto (p. ej. 'jarvis': la respuesta en directo)
export function useMensajes(type, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    conectar();
    const f = (m) => ref.current(m);
    if (!oyentesTipo.has(type)) oyentesTipo.set(type, new Set());
    oyentesTipo.get(type).add(f);
    return () => oyentesTipo.get(type).delete(f);
  }, [type]);
}

// Carga un recurso y lo recarga solo cuando hay cambios. Si lo que llega es igual que lo que había, no se toca (así no se vuelve a pintar toda la página) y si ya hay
// una petición en marcha no se lanza otra igual.
export function useRecurso(path, inicial) {
  const [data, setData] = useState(inicial);
  const [error, setError] = useState(null);
  const ultimo = useRef(null);
  const enMarcha = useRef(null);
  const otraVez = useRef(false);
  const cargar = useCallback(() => {
    if (!path) return;
    // Ya se está pidiendo: al terminar se pide otra vez (lo que ha cambiado entretanto no se pierde)
    if (enMarcha.current === path) { otraVez.current = true; return; }
    enMarcha.current = path;
    fetch(path).then(async (r) => {
      const texto = await r.text();
      let d = {};
      try { d = texto ? JSON.parse(texto) : {}; } catch { /* sin JSON */ }
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setError(null);
      if (texto === ultimo.current) return;
      ultimo.current = texto;
      setData(d);
    }).catch((e) => setError(e.message)).finally(() => {
      if (enMarcha.current !== path) return;
      enMarcha.current = null;
      if (otraVez.current) { otraVez.current = false; cargar(); }
    });
  }, [path]);
  useEffect(() => { ultimo.current = null; cargar(); }, [cargar]);
  useCambios(cargar);
  // setData a mano (p. ej. un cambio optimista): lo siguiente que llegue del servidor se pinta aunque sea igual
  const poner = useCallback((v) => { ultimo.current = null; setData(v); }, []);
  return [data, cargar, error, poner];
}

export const obsidianUrl = (vault, ruta) =>
  `obsidian://open?vault=${encodeURIComponent(vault)}${ruta ? `&file=${encodeURIComponent(ruta.replace(/\.md$/i, ''))}` : ''}`;

export const normaliza = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
