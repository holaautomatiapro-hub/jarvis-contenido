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

export function useCambios(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    conectar();
    const f = () => ref.current();
    oyentes.add(f);
    window.addEventListener('focus', f);
    const id = setInterval(f, 30000);
    return () => { oyentes.delete(f); window.removeEventListener('focus', f); clearInterval(id); };
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

// Carga un recurso y lo recarga solo cuando hay cambios
export function useRecurso(path, inicial) {
  const [data, setData] = useState(inicial);
  const [error, setError] = useState(null);
  const cargar = useCallback(() => {
    if (!path) return;
    api(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [path]);
  useEffect(cargar, [cargar]);
  useCambios(cargar);
  return [data, cargar, error, setData];
}

export const obsidianUrl = (vault, ruta) =>
  `obsidian://open?vault=${encodeURIComponent(vault)}${ruta ? `&file=${encodeURIComponent(ruta.replace(/\.md$/i, ''))}` : ''}`;

export const normaliza = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
