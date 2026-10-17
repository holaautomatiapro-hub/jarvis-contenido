import path from 'node:path';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promptReplicarEnPieza } from './replicar.js';

// «Guardar como idea» desde una publicación o un anuncio de la competencia: una idea en 01-Ideas con la referencia
// (enlace, señales y caption) y, si se pide, lo que se dice en el vídeo o el texto de los slides. La transcripción
// va en segundo plano (como las demás) y se añade a la nota de la idea al terminar; el texto de los slides lo lee
// Claude mirando las imágenes.

const publico = (m) => Object.assign(new Error(m), { publico: true });
const primeraLinea = (t) => String(t || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
const recortar = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
const fecha = (f) => String(f || '').slice(0, 10);
const linea = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ');

export function createReferencias({ jarvis, competencia, ads, adjuntos, asistente, kit = null, vaultPath, fetchImpl = fetch }) {
  // Donde se guarda el vídeo de un reel de la competencia al transcribirlo (para verlo después en la ficha)
  const rutaVideoCompetencia = (id) => path.join(vaultPath, '.jarvis', 'competencia', 'videos', String(id).replace(/[^\w-]/g, '_'), 'video.mp4');
  // Lo que hay que saber de cada fuente: el título de la idea, su nota y cómo sacar el vídeo o las imágenes
  function dePublicacion(id) {
    const m = competencia.detalle(id);
    const reel = m.formato === 'Reels';
    const formato = reel ? 'Reel' : m.hijos?.length > 1 ? 'Carrusel' : 'Post';
    return {
      formato, enlace: m.permalink || `competencia:${m.id}`, video: reel, transcripcion: m.transcripcion || null,
      titulo: `@${m.username}: ${recortar(m.gancho || primeraLinea(m.caption) || m.formato, 90)}`,
      contenido: [
        `**Referencia:** @${m.username} · ${m.formato} del ${fecha(m.fecha)}${m.permalink ? ` · ${m.permalink}` : ''}`,
        linea({ 'me gusta': m.likes, comentarios: m.comentarios, visualizaciones: m.vistas, engagement: m.engagement != null ? `${m.engagement} %` : null }),
        '', '## Caption', '', m.caption || '(sin caption)',
      ],
      // El vídeo del reel, bajado al vault (Instagram no siempre lo da)
      rutaVideo: async () => {
        if (!m.media_url) throw publico('Instagram no da el vídeo de este reel (pasa con algunos reels con música con derechos): súbelo desde el detalle para transcribirlo');
        const f = rutaVideoCompetencia(m.id);
        const dir = path.dirname(f);
        if (!existsSync(f)) {
          mkdirSync(dir, { recursive: true });
          const r = await fetchImpl(m.media_url, { signal: AbortSignal.timeout(180000) });
          if (!r.ok || !r.body) throw publico('El enlace del vídeo ha caducado: vuelve a sincronizar o sube el vídeo desde el detalle');
          await pipeline(Readable.fromWeb(r.body), createWriteStream(f));
        }
        return { ruta: f, dir };
      },
      imagenes: async () => competencia.descargarSlides(m.id),
      guardarTranscripcion: (texto, nota) => competencia.guardarTranscripcion(m.id, texto, nota),
      clave: `comp-${m.id}`,
    };
  }

  function deAnuncio(id) {
    const a = ads.anuncioCompetencia(id);
    const textos = a.cuerpos?.length ? a.cuerpos : [a.cuerpo].filter(Boolean);
    return {
      formato: a.video || !a.imagenes?.length ? 'Reel' : a.imagenes.length > 1 ? 'Carrusel' : 'Post',
      enlace: a.verEnBiblioteca, video: null, transcripcion: a.transcripcion || null,
      titulo: `Anuncio ${a.pagina}: ${recortar(a.titulo || primeraLinea(textos[0]) || 'sin texto', 80)}`,
      contenido: [
        `**Referencia:** anuncio de ${a.pagina}, activo desde el ${fecha(a.inicio)} · ${a.verEnBiblioteca}`,
        linea({ 'días activo': a.diasActivo, variantes: a.variantes > 1 ? a.variantes : null, 'alcance UE': a.alcance_ue, plataformas: a.plataformas }),
        '', `## Texto del anuncio${textos.length > 1 ? ` (${textos.length} versiones)` : ''}`, '', textos.join('\n\n---\n\n') || '(sin texto)',
        ...(a.titulo || a.descripcion ? ['', [a.titulo && `**${a.titulo}**`, a.descripcion].filter(Boolean).join(' · ')] : []),
      ],
      // Vídeo o imágenes: se traen de la Biblioteca si aún no están
      medios: async () => { if (!a.video && !a.imagenes?.length) await ads.mediosAnuncio(a.id); return ads.paraAdaptar(a.id); },
      guardarTranscripcion: (texto, nota) => ads.guardarTranscripcionAnuncio(a.id, texto, nota),
      clave: `anuncio-${a.id}`,
    };
  }

  const anadir = (ruta, texto) => jarvis.vault.append(ruta, `\n${texto.trim()}\n`);

  // Claude lee las imágenes en orden y añade su texto a la nota de la idea
  function leerSlides(nota, imagenes) {
    const texto = `Lee con Read, en este orden, las imágenes de un carrusel o anuncio de la competencia que he guardado como idea:
${imagenes.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Saca el texto de cada una tal cual (titulares y textos, sin inventar ni resumir) y, si ayuda, una línea entre corchetes con lo que se ve.
Después lee la nota «${nota}» con leer_nota y guárdala con editar_nota añadiendo AL FINAL una sección «## Texto de los slides» con «**Slide N:** …» para cada imagen. No cambies nada más de la nota ni su título. No crees notas ni piezas. Responde en una línea.`;
    return asistente.preguntar({ conversacion: 'sistema', modelo: 'sonnet', texto });
  }

  // fuente: 'competencia' | 'anuncio'. conTranscripcion: añade lo que se dice en el vídeo o el texto de los slides.
  async function guardarComoIdea({ fuente, id, conTranscripcion = false }) {
    if ((fuente === 'anuncio' && !ads) || (fuente === 'competencia' && !competencia)) throw publico('Aquí no está la competencia');
    const f = fuente === 'anuncio' ? deAnuncio(id) : fuente === 'competencia' ? dePublicacion(id) : null;
    if (!f) throw publico('No sé de dónde sale esa idea');
    const { pieza, nota, ya } = jarvis.guardarIdea({ titulo: f.titulo, contenido: f.contenido.join('\n'), origen: 'competencia', formato: f.formato, origen_ref: f.enlace });
    const r = { pieza, nota, ya: Boolean(ya) };
    if (!conTranscripcion) return r;
    const contenidoNota = () => jarvis.vault.read(nota).contenido;
    const yaTiene = (seccion) => contenidoNota().includes(seccion);

    // Ya transcrito: va directo a la nota
    if (f.transcripcion) {
      if (!yaTiene('## Transcripción')) anadir(nota, `## Transcripción\n\n${f.transcripcion}`);
      return { ...r, transcripcion: true };
    }

    // ¿Vídeo o imágenes? En los anuncios depende de lo que traiga la Biblioteca
    let medios = null;
    if (fuente === 'anuncio') {
      try { medios = await f.medios(); } catch (e) { return { ...r, aviso: `La idea se ha guardado, pero sin transcripción: ${e.message}` }; }
    }
    const esVideo = fuente === 'anuncio' ? Boolean(medios.video) : f.video;

    if (esVideo) {
      if (!adjuntos) return { ...r, aviso: 'La idea se ha guardado; aquí no se puede transcribir' };
      const t = adjuntos.encargar(`idea-${f.clave}`, `Transcribiendo para la idea «${recortar(f.titulo, 50)}»`, async (tarea) => {
        const v = fuente === 'anuncio' ? { ruta: medios.video, dir: path.dirname(medios.video) } : await f.rutaVideo();
        const x = await adjuntos.transcribirRuta(v.ruta, { dir: v.dir, nombre: `${f.clave}.mp4`, tarea });
        f.guardarTranscripcion(x.texto, nota);
        if (!yaTiene('## Transcripción')) anadir(nota, `## Transcripción\n\n${x.texto}`);
        return { transcripcion: x.texto, con: x.con || null, nota };
      });
      return { ...r, tarea: adjuntos.verTarea(t) };
    }

    // Carrusel o imagen: el texto de cada slide
    let imagenes = [];
    try { imagenes = fuente === 'anuncio' ? medios.imagenes : await f.imagenes(); } catch (e) { return { ...r, aviso: `La idea se ha guardado, pero sin el texto de los slides: ${e.message}` }; }
    if (!imagenes.length) return { ...r, aviso: 'La idea se ha guardado; no hay imágenes de las que sacar el texto' };
    const enVault = imagenes.map((x) => path.relative(vaultPath, x)).filter((x) => !x.startsWith('..'));
    if (enVault.length && !yaTiene('## Slides')) anadir(nota, `## Slides\n\n${enVault.map((x) => `![[${x.replace(/\\/g, '/')}]]`).join('\n')}`);
    if (yaTiene('## Texto de los slides')) return { ...r, transcripcion: true };
    if (!asistente) return { ...r, aviso: 'La idea se ha guardado con las imágenes; aquí no se puede leer su texto' };
    try {
      const p = leerSlides(nota, imagenes);
      return { ...r, leyendo: true, peticion: p?.id ?? null };
    } catch (e) {
      return { ...r, aviso: `La idea se ha guardado con las imágenes, pero JARVIS no ha podido leer los slides ahora (${e.message}). Vuelve a pulsar «Guardar como idea» con el texto en un rato.` };
    }
  }

  // ---------- La ficha de una idea guardada de la competencia ----------
  // De qué publicación o anuncio sale (por su enlace), con su caption, su transcripción y sus medios
  const seccion = (md, titulo) => {
    const m = new RegExp(`^## ${titulo}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(md || '');
    return m ? m[1].trim() || null : null;
  };
  function origenDe(p) {
    const ref = String(p.origen_ref || '');
    const anuncio = /facebook\.com\/ads\/library\/\?id=(\d+)/.exec(ref)?.[1];
    if (anuncio && ads) { try { return { fuente: 'anuncio', id: anuncio, detalle: ads.anuncioCompetencia(anuncio) }; } catch { /* ya no está */ } }
    if (competencia) {
      const id = ref.startsWith('competencia:') ? ref.slice(12) : competencia.idPorEnlace(ref);
      if (id) { try { return { fuente: 'competencia', id: String(id), detalle: competencia.detalle(id) }; } catch { /* ya no está */ } }
    }
    return null;
  }
  const esReferencia = (p) => p?.origen === 'competencia' && Boolean(p.origen_ref);
  function referenciaDePieza(id) {
    const p = jarvis.leerPieza(id);
    if (!esReferencia(p)) throw publico('Esta pieza no sale de una publicación guardada como idea');
    const o = origenDe(p);
    const nota = p.nota && jarvis.vault.existe(p.nota) ? jarvis.vault.read(p.nota).contenido : '';
    const d = o?.detalle || {};
    const video = o?.fuente === 'anuncio' ? d.video || null
      : o?.fuente === 'competencia' && d.formato === 'Reels' && (existsSync(rutaVideoCompetencia(o.id)) || d.media_url) ? `/api/competencia/publicaciones/${encodeURIComponent(o.id)}/video` : null;
    const imagenes = o?.fuente === 'anuncio' ? d.imagenes || []
      : o?.fuente === 'competencia' ? (d.slides || []).map((f) => `/api/competencia/publicaciones/${encodeURIComponent(o.id)}/slides/${f}`) : [];
    const formato = p.formato || (o?.fuente === 'competencia' && d.formato === 'Reels' ? 'Reel' : null);
    return {
      pieza: p, fuente: o?.fuente || null, fuenteId: o?.id || null, enlace: p.origen_ref, nota: p.nota || null,
      cuenta: o?.fuente === 'anuncio' ? d.pagina : d.username ? `@${d.username}` : null, fecha: (o?.fuente === 'anuncio' ? d.inicio : d.fecha) || null,
      caption: o?.fuente === 'anuncio' ? (d.cuerpos?.length ? d.cuerpos.join('\n\n---\n\n') : d.cuerpo) || seccion(nota, 'Texto del anuncio[^\\n]*') : d.caption || seccion(nota, 'Caption'),
      transcripcion: d.transcripcion || seccion(nota, 'Transcripción'),
      textoSlides: seccion(nota, 'Texto de los slides'),
      senales: (nota.split('\n').find((l, i, ls) => i > 0 && ls[i - 1].startsWith('**Referencia:**')) || '').trim() || null,
      video, imagenes, esVideo: o?.fuente === 'anuncio' ? Boolean(d.video) : d.formato === 'Reels',
      puedeDisenar: ['Carrusel', 'Post'].includes(formato) || (o?.fuente === 'competencia' && d.formato !== 'Reels') || (o?.fuente === 'anuncio' && !d.video && d.imagenes?.length > 0),
      replicando: replicandoPieza(p.id),
      // Las plantillas del kit que sirven para carrusel (para «Completo»)
      plantillas: (kit?.estado?.().plantillas || []).filter((x) => !x.formatos?.length || x.formatos.includes('carrusel')).map(({ id: pid, nombre, descripcion }) => ({ id: pid, nombre, descripcion })),
    };
  }

  // «Replicar» desde la ficha: el guion (y, en completo, el diseño con tu kit) va en esta misma pieza
  let enMarcha = null; // { pieza, peticion }
  const replicandoPieza = (id) => Boolean(asistente && enMarcha?.pieza === Number(id) && asistente.estado({ conversacion: 'replicar' }).ocupadoAqui);
  async function replicarEnPieza(id, { modo = 'guion', indicaciones = '', plantilla = null, cta = null } = {}) {
    if (!asistente) throw publico('JARVIS (Claude Code) no está disponible');
    if (asistente.estado({ conversacion: 'replicar' }).ocupado) throw Object.assign(publico('JARVIS está terminando otra petición. Espera un momento.'), { ocupado: true });
    const r = referenciaDePieza(id);
    const completo = modo === 'completo';
    if (completo && !r.puedeDisenar) throw publico('El diseño con tu kit es para posts y carruseles; de un reel se replica el guion');
    let plantillaOk = null;
    if (completo && plantilla) {
      const lista = kit?.estado?.().plantillas || [];
      plantillaOk = lista.find((x) => x.id === plantilla) || null;
      if (!plantillaOk) throw publico('Esa plantilla no está en tu kit de diseño');
    }
    // Las imágenes originales, para que Claude las mire (del vault)
    let imagenes = [];
    try {
      if (r.fuente === 'competencia' && !r.esVideo) imagenes = await competencia.descargarSlides(r.fuenteId);
      if (r.fuente === 'anuncio') imagenes = ads.paraAdaptar(r.fuenteId).imagenes;
    } catch { /* se replica con el texto */ }
    const ruta = jarvis.notaGuion(r.pieza.id);
    const texto = promptReplicarEnPieza(jarvis.leerPieza(r.pieza.id), {
      ruta, referencia: r.nota, enlace: r.enlace, imagenes, completo, plantilla: plantillaOk, indicaciones,
      cta: cta?.tipo === 'otro' && String(cta.texto || '').trim() ? String(cta.texto).trim() : null,
    });
    const p = asistente.preguntar({ conversacion: 'replicar', texto, modelo: completo ? 'opus' : undefined });
    enMarcha = { pieza: r.pieza.id, peticion: p?.id ?? null };
    return { ok: true, peticion: p?.id ?? null, ruta };
  }

  return { guardarComoIdea, referenciaDePieza, replicarEnPieza, rutaVideoCompetencia, esReferencia };
}
