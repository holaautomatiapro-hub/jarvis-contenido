// Cómo va un diseño que está haciendo Claude: el paso marca el tramo de la barra y el tiempo avanza dentro de él
export function avanceDiseno(t, ahora = Date.now()) {
  const pasado = Math.max(0, ahora - t.inicio);
  const pct = Math.round(Math.min(t.hasta, Math.max(t.desde, (pasado / t.estimado) * 100)));
  return { pct, pasado, queda: t.estimado - pasado, quieto: Math.max(0, ahora - t.senal) };
}
