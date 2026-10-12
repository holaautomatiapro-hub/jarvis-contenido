import { ajustes, row, rows } from './db.js';
import { lunesDe, sumarDias } from './tareas.js';
import { hoy, JarvisError } from './jarvis.js';
import { nombreArchivo } from './vault.js';

// Resultados: une cada pieza con su publicación de Instagram (la de Facebook y la de Windsor son la misma fila
// de ig_media, con el id de Instagram), dice qué te funciona (por pilar, objetivo, formato, CTA y gancho)
// y escribe cada lunes el informe de la semana anterior en 07-Diario. Todo con datos, sin IA.

// Tipo de pieza → formato de Instagram (las stories no llegan como publicaciones)
const FORMATO_IG = { reel: 'Reels', short: 'Reels', 'reel split': 'Reels', 'b-roll': 'Reels', carrusel: 'Carruseles', post: 'Imágenes' };
export const formatoIgDe = (formato) => FORMATO_IG[String(formato || '').trim().toLowerCase()] || null;

// Texto comparable: sin negritas de Instagram (𝗮𝘀𝗶́), tildes, emojis ni signos
export const textoComparable = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\*\*/g, '')
  .toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
const mismoCaption = (a, b) => {
  const x = textoComparable(a).slice(0, 80), y = textoComparable(b).slice(0, 80);
  return x.length >= 20 && y.length >= 20 && (x === y || x.startsWith(y) || y.startsWith(x));
};
const enlaceLimpio = (u) => String(u || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '');
const diaDe = (fecha) => new Date(fecha).toLocaleDateString('sv-SE');
const entre = (d, desde, hasta) => d >= desde && d <= hasta;
const redondo = (n, dec = 0) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dec) / 10 ** dec);
const media = (l, f) => (l.length ? l.reduce((a, x) => a + (Number(f(x)) || 0), 0) / l.length : 0);

export function createResultados({ db, jarvis, vault, alCambiar = () => {} }) {
  const aj = ajustes(db);
  const q = {
    media: db.prepare('SELECT * FROM ig_media ORDER BY fecha DESC'),
    mediaDesde: db.prepare('SELECT * FROM ig_media WHERE fecha >= ? ORDER BY fecha DESC'),
    unaMedia: db.prepare('SELECT * FROM ig_media WHERE id = ?'),
    piezas: db.prepare("SELECT * FROM piezas WHERE estado != 'idea' OR ig_media_id IS NOT NULL"),
    vincular: db.prepare("UPDATE piezas SET ig_media_id = ?, ig_vinculo = ?, ig_permalink = COALESCE(?, ig_permalink), actualizado = datetime('now','localtime') WHERE id = ?"),
    soltar: db.prepare("UPDATE piezas SET ig_media_id = NULL, ig_vinculo = 'ninguna', actualizado = datetime('now','localtime') WHERE id = ?"),
    usada: db.prepare('SELECT id, titulo FROM piezas WHERE ig_media_id = ? AND id != ?'),
  };

  // ---------- Unir piezas y publicaciones ----------
  function enlazar(p, m, como) {
    q.vincular.run(m.id, como, m.permalink || null, p.id);
    // Lo que está en Instagram está publicado (y, si no tenía día, el de Instagram)
    const cambios = {};
    if (p.estado !== 'publicado') cambios.estado = 'publicado';
    if (!p.fecha && m.fecha) cambios.fecha = diaDe(m.fecha);
    if (Object.keys(cambios).length) jarvis.actualizarPieza(p.id, cambios, 'instagram');
  }

  // Une solo lo que está claro: lo que publicó JARVIS, el enlace de la publicación, el mismo caption
  // o (si no hay duda) el mismo día y formato. Lo que se suelta a mano no se vuelve a unir.
  function vincularTodo() {
    const todas = rows(q.media);
    if (!todas.length) return { vinculadas: 0 };
    const piezas = rows(q.piezas);
    const usadas = new Set(piezas.map((p) => p.ig_media_id).filter(Boolean));
    const libres = () => todas.filter((m) => !usadas.has(m.id));
    const pendientes = () => piezas.filter((p) => !p.ig_media_id && p.ig_vinculo !== 'ninguna');
    let n = 0;
    const unir = (p, m, como) => { enlazar(p, m, como); p.ig_media_id = m.id; usadas.add(m.id); n++; };

    // 1. Publicadas por JARVIS: ya guardan el id; solo se marca cómo
    for (const p of piezas) if (p.ig_media_id && !p.ig_vinculo) q.vincular.run(p.ig_media_id, 'jarvis', null, p.id);
    // 2. Por enlace (el de Instagram puesto en «URL del vídeo»)
    for (const p of pendientes()) {
      const e = enlaceLimpio(p.video_url || p.ig_permalink);
      if (!/instagram\.com\//.test(e)) continue;
      const m = libres().find((x) => x.permalink && enlaceLimpio(x.permalink) === e);
      if (m) unir(p, m, 'enlace');
    }
    // 3. Por caption (cerca de su fecha, si la tiene)
    for (const p of pendientes()) {
      if (!p.caption) continue;
      const cerca = (m) => !p.fecha || entre(diaDe(m.fecha), sumarDias(p.fecha, -2), sumarDias(p.fecha, 3));
      const m = libres().find((x) => cerca(x) && mismoCaption(p.caption, x.caption));
      if (m) unir(p, m, 'caption');
    }
    // 4. Mismo día y formato, solo si es la única opción por los dos lados
    for (const p of pendientes()) {
      const f = formatoIgDe(p.formato);
      if (!p.fecha || !f || !['listo', 'publicado'].includes(p.estado)) continue;
      const cands = libres().filter((m) => m.formato === f && diaDe(m.fecha) === p.fecha);
      const rivales = pendientes().filter((x) => x.id !== p.id && x.fecha === p.fecha && formatoIgDe(x.formato) === f);
      if (cands.length === 1 && !rivales.length) unir(p, cands[0], 'fecha');
    }
    if (n) alCambiar();
    return { vinculadas: n };
  }

  // A mano: unir con una publicación concreta, o soltarla (null) para que no se vuelva a unir sola
  function vincular(piezaId, mediaId) {
    const p = jarvis.leerPieza(piezaId);
    if (!mediaId) { q.soltar.run(p.id); alCambiar(); return jarvis.leerPieza(p.id); }
    const m = row(q.unaMedia, String(mediaId));
    if (!m) throw new JarvisError('Esa publicación de Instagram no está: sincroniza Instagram');
    const otra = row(q.usada, m.id, p.id);
    if (otra) throw new JarvisError(`Esa publicación ya está unida a «${otra.titulo}»`);
    enlazar(p, m, 'manual');
    alCambiar();
    return jarvis.leerPieza(p.id);
  }

  // Publicaciones cerca del día de una pieza, para elegir a mano
  function candidatas(piezaId) {
    const p = jarvis.leerPieza(piezaId);
    const usadas = new Set(rows(q.piezas).filter((x) => x.ig_media_id && x.id !== p.id).map((x) => x.ig_media_id));
    const ref = p.fecha || hoy();
    return rows(q.mediaDesde, sumarDias(ref, -10)).filter((m) => diaDe(m.fecha) <= sumarDias(ref, 10))
      .map((m) => ({ id: m.id, fecha: m.fecha, formato: m.formato, caption: String(m.caption || '').slice(0, 140), miniatura: m.miniatura, permalink: m.permalink, alcance: m.alcance, usada: usadas.has(m.id) }));
  }

  // ---------- Métricas ----------
  const tasa = (m) => (m.alcance ? (Number(m.interacciones) || 0) / m.alcance : 0);
  // Guardados + compartidos por cada 1.000 de alcance: lo que la gente quiere conservar o pasar
  const valor = (m) => (m.alcance ? ((Number(m.guardados) || 0) + (Number(m.compartidos) || 0)) / m.alcance * 1000 : 0);
  const resumenMedia = (m) => ({
    id: m.id, fecha: m.fecha, formato: m.formato, permalink: m.permalink, miniatura: m.miniatura,
    alcance: m.alcance, views: m.views, likes: m.likes, comentarios: m.comentarios, guardados: m.guardados, compartidos: m.compartidos,
    interacciones: m.interacciones, tasa: redondo(tasa(m) * 100, 1), valor: redondo(valor(m), 1),
  });

  // Métricas de la publicación de una pieza, frente a la media de su formato en los últimos 90 días
  function deLaPieza(piezaId) {
    const p = jarvis.leerPieza(piezaId);
    if (!p.ig_media_id) return { pieza: p.id, vinculo: p.ig_vinculo || null, metricas: null };
    const m = row(q.unaMedia, p.ig_media_id);
    if (!m) return { pieza: p.id, vinculo: p.ig_vinculo, metricas: null, aviso: 'Aún no han llegado sus métricas: se verán tras la próxima sincronización de Instagram' };
    const comparables = rows(q.mediaDesde, sumarDias(hoy(), -90)).filter((x) => x.formato === m.formato && x.id !== m.id);
    const mediaAlcance = media(comparables, (x) => x.alcance);
    return {
      pieza: p.id, vinculo: p.ig_vinculo, metricas: resumenMedia(m),
      comparado: comparables.length ? {
        con: comparables.length, formato: m.formato,
        alcance: mediaAlcance ? redondo(((m.alcance || 0) / mediaAlcance - 1) * 100) : null,
        tasa: redondo(media(comparables, tasa) * 100, 1), valor: redondo(media(comparables, valor), 1),
      } : null,
    };
  }

  // Lo más corto para las listas: { piezaId: { alcance, views, guardados, compartidos } }
  function porPieza() {
    const m = new Map(rows(q.media).map((x) => [x.id, x]));
    const out = {};
    for (const p of rows(q.piezas)) {
      const x = p.ig_media_id && m.get(p.ig_media_id);
      if (x) out[p.id] = { alcance: x.alcance, views: x.views, guardados: x.guardados, compartidos: x.compartidos, tasa: redondo(tasa(x) * 100, 1) };
    }
    return out;
  }

  // ---------- Qué te funciona ----------
  function queFunciona({ dias = 90 } = {}) {
    const desde = sumarDias(hoy(), -dias);
    const lista = rows(q.mediaDesde, desde);
    const piezaDe = new Map(rows(q.piezas).filter((p) => p.ig_media_id).map((p) => [p.ig_media_id, p]));
    const unidas = lista.filter((m) => piezaDe.has(m.id)).map((m) => ({ m, p: piezaDe.get(m.id) }));
    const base = { alcance: media(lista, (m) => m.alcance), tasa: media(lista, tasa), valor: media(lista, valor) };

    const grupo = (clave, l) => {
      const alc = media(l, (m) => m.alcance);
      return {
        clave, piezas: l.length, pocas: l.length < 3,
        alcanceMedio: Math.round(alc), tasa: redondo(media(l, tasa) * 100, 1), valor: redondo(media(l, valor), 1),
        vsMedia: base.alcance ? redondo((alc / base.alcance - 1) * 100) : null,
      };
    };
    const agrupar = (pares, claveDe) => {
      const g = new Map();
      for (const x of pares) { const k = claveDe(x); if (!k) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(x.m); }
      return [...g.entries()].map(([k, l]) => grupo(k, l)).sort((a, b) => (a.pocas - b.pocas) || (b.vsMedia ?? 0) - (a.vsMedia ?? 0));
    };
    const ctaNorm = (t) => { const s = String(t || '').trim(); return s ? s.replace(/\s+/g, ' ').slice(0, 60) : null; };
    const OBJ = { atraer: 'Atraer', nutrir: 'Nutrir', convertir: 'Convertir' };

    const porPilar = agrupar(unidas, (x) => x.p.pilar);
    const porObjetivo = agrupar(unidas, (x) => OBJ[x.p.objetivo]);
    const porCta = agrupar(unidas, (x) => ctaNorm(x.p.cta));
    const porFormato = agrupar(lista.map((m) => ({ m })), (x) => x.m.formato);
    const conGancho = unidas.map(({ m, p }) => ({ m, p, gancho: p.gancho || m.gancho })).filter((x) => x.gancho);
    const ordenados = [...conGancho].sort((a, b) => (b.m.alcance || 0) - (a.m.alcance || 0));
    const fila = ({ m, p, gancho }) => ({ piezaId: p.id, titulo: p.titulo, gancho, formato: m.formato, alcance: m.alcance, vsMedia: base.alcance ? redondo(((m.alcance || 0) / base.alcance - 1) * 100) : null, permalink: m.permalink });

    // Conclusiones solo con grupos de 3 piezas o más
    const conclusiones = [];
    const fiable = (l) => l.filter((g) => !g.pocas && g.vsMedia != null);
    const frase = (que, l) => {
      const f = fiable(l);
      if (f.length < 2) return;
      const mejor = f[0], peor = f.at(-1);
      if (mejor.vsMedia > 10) conclusiones.push(`${que} «${mejor.clave}» llega a un ${mejor.vsMedia} % más de gente que tu media (${mejor.piezas} piezas).`);
      if (peor.vsMedia < -10) conclusiones.push(`${que} «${peor.clave}» se queda un ${Math.abs(peor.vsMedia)} % por debajo de tu media (${peor.piezas} piezas).`);
    };
    frase('El pilar', porPilar);
    frase('El formato', porFormato);
    frase('El objetivo', porObjetivo);
    const valorMejor = fiable(porPilar).sort((a, b) => b.valor - a.valor)[0];
    if (valorMejor && valorMejor.valor > (base.valor || 0) * 1.2) conclusiones.push(`Lo que más se guarda y se comparte es el pilar «${valorMejor.clave}» (${valorMejor.valor} por cada 1.000 personas, tu media es ${redondo(base.valor, 1)}).`);

    return {
      dias, desde,
      cobertura: { publicaciones: lista.length, conPieza: unidas.length, conPilar: unidas.filter((x) => x.p.pilar).length, conObjetivo: unidas.filter((x) => x.p.objetivo).length },
      medias: { alcance: Math.round(base.alcance), tasa: redondo(base.tasa * 100, 1), valor: redondo(base.valor, 1) },
      porPilar, porObjetivo, porFormato, porCta,
      mejoresGanchos: ordenados.slice(0, 5).map(fila),
      peoresGanchos: ordenados.length > 5 ? ordenados.slice(-3).reverse().map(fila) : [],
      conclusiones,
    };
  }

  // ---------- Informe semanal (07-Diario) ----------
  function datosSemana(fechaCualquiera) {
    const lunes = lunesDe(fechaCualquiera), domingo = sumarDias(lunes, 6);
    const semana = jarvis.miSemana({ fecha: domingo });
    const proxima = jarvis.miSemana({ fecha: sumarDias(lunes, 7) });
    const delRango = (a, b) => rows(q.mediaDesde, a).filter((m) => entre(diaDe(m.fecha), a, b));
    const esta = delRango(lunes, domingo), anterior = delRango(sumarDias(lunes, -7), sumarDias(lunes, -1));
    const suma = (l, k) => l.reduce((a, m) => a + (Number(m[k]) || 0), 0);
    const piezaDe = new Map(rows(q.piezas).filter((p) => p.ig_media_id).map((p) => [p.ig_media_id, p]));
    const titulo = (m) => piezaDe.get(m.id)?.titulo || String(m.caption || '').split('\n')[0].slice(0, 80) || '(sin texto)';
    const publicaciones = esta.map((m) => ({ ...resumenMedia(m), titulo: titulo(m), pilar: piezaDe.get(m.id)?.pilar || null })).sort((a, b) => (b.alcance || 0) - (a.alcance || 0));
    const publicadas = semana.dias.reduce((a, d) => a + d.piezas.filter((p) => p.publicada).length, 0);
    return {
      lunes, domingo,
      numeros: ['alcance', 'views', 'guardados', 'compartidos', 'interacciones'].map((k) => ({ k, valor: suma(esta, k), antes: suma(anterior, k) })),
      publicadas, publicaciones,
      ritmo: semana.progreso,
      huecos: semana.dias.filter((d) => d.publicas && !d.piezas.some((p) => p.publicada)).map((d) => d.fecha),
      proxima: { huecos: proxima.dias.filter((d) => d.hueco).map((d) => d.fecha), producir: proxima.producir.filter((p) => p.fecha <= proxima.hasta) },
      funciona: queFunciona({ dias: 90 }),
    };
  }

  const NOMBRES = { alcance: 'Alcance', views: 'Visualizaciones', guardados: 'Guardados', compartidos: 'Compartidos', interacciones: 'Interacciones' };
  const num = (n) => (n == null ? '—' : new Intl.NumberFormat('es-ES').format(n));
  const dia = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  function markdown(d) {
    const cambio = (a, b) => (b ? ` (${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)} % frente a la anterior)` : '');
    const top = d.publicaciones.slice(0, 3), peor = d.publicaciones.length > 3 ? d.publicaciones.at(-1) : null;
    const linea = (p) => `- **${p.titulo}** · ${p.formato}${p.pilar ? ` · ${p.pilar}` : ''} · alcance ${num(p.alcance)}, ${num(p.guardados)} guardados, ${num(p.compartidos)} compartidos${p.permalink ? ` · [ver](${p.permalink})` : ''}`;
    return [
      '---', 'tipo: informe-semanal', `semana: ${d.lunes}`, `creado: ${new Date().toLocaleString('sv-SE').slice(0, 16)}`, '---',
      `# Informe de la semana del ${dia(d.lunes)}`, '',
      '## Números', '',
      ...(d.publicaciones.length ? d.numeros.map((x) => `- ${NOMBRES[x.k]}: ${num(x.valor)}${cambio(x.valor, x.antes)}`) : ['- No hay publicaciones de Instagram de esta semana (o aún no se han sincronizado).']),
      `- Piezas publicadas: ${d.publicadas}`, '',
      '## Ritmo', '',
      ...(d.ritmo.length ? d.ritmo.map((r) => `- ${r.tipo}: ${r.publicadas} de ${r.objetivo}${r.publicadas >= r.objetivo ? ' ✅' : ''}`) : ['- Sin ritmo definido (Inicio → Tu semana → Ritmo).']),
      ...(d.huecos.length ? [`- Días de publicación sin nada publicado: ${d.huecos.map(dia).join(', ')}`] : []), '',
      '## Lo mejor', '', ...(top.length ? top.map(linea) : ['- Sin datos.']), '',
      ...(peor ? ['## Lo que menos', '', linea(peor), ''] : []),
      '## Qué te funciona (últimos 90 días)', '',
      ...(d.funciona.conclusiones.length ? d.funciona.conclusiones.map((c) => `- ${c}`) : ['- Aún no hay suficientes piezas con pilar y métricas para sacar conclusiones (hacen falta 3 por grupo).']),
      `- ${d.funciona.cobertura.conPieza} de ${d.funciona.cobertura.publicaciones} publicaciones están unidas a su pieza; ${d.funciona.cobertura.conPilar} tienen pilar.`, '',
      `## Esta semana (desde el ${dia(sumarDias(d.lunes, 7))})`, '',
      ...(d.proxima.huecos.length ? [`- Huecos: ${d.proxima.huecos.map(dia).join(', ')}`] : ['- Sin huecos.']),
      ...(d.proxima.producir.length ? ['- Por producir:', ...d.proxima.producir.map((p) => `  - ${p.titulo} (${p.etiqueta}) · sale el ${dia(p.fecha)}`)] : []),
      '',
    ].join('\n');
  }

  function informeSemanal({ fecha = sumarDias(hoy(), -7) } = {}) {
    const d = datosSemana(fecha);
    const ruta = `07-Diario/${nombreArchivo(`Informe semana ${d.lunes}`)}.md`;
    const nota = vault.write(ruta, markdown(d));
    aj.guardar('informe_semanal', { lunes: d.lunes, nota, fecha: new Date().toISOString() });
    alCambiar();
    return { nota, lunes: d.lunes, datos: d };
  }

  // Lo que se hace solo: unir publicaciones y, desde el lunes, el informe de la semana pasada (una vez)
  function alDia() {
    const r = vincularTodo();
    const pasada = sumarDias(lunesDe(hoy()), -7);
    const ultimo = aj.leer('informe_semanal', null);
    let informe = null;
    if (ultimo?.lunes !== pasada) {
      const hayAlgo = rows(q.mediaDesde, pasada).some((m) => diaDe(m.fecha) < lunesDe(hoy()))
        || jarvis.listarPiezas({ estado: 'publicado' }).some((p) => p.fecha && entre(p.fecha, pasada, sumarDias(pasada, 6)));
      if (hayAlgo) informe = informeSemanal({ fecha: pasada }).nota;
    }
    return { ...r, informe };
  }

  const ultimoInforme = () => aj.leer('informe_semanal', null);

  return { vincularTodo, vincular, candidatas, deLaPieza, porPieza, queFunciona, informeSemanal, alDia, ultimoInforme, datosSemana };
}
