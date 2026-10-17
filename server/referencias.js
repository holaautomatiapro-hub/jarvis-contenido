import path from 'node:path';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// «Guardar como idea» desde una publicación o un anuncio de la competencia: una idea en 01-Ideas con la referencia
// (enlace, señales y caption) y, si se pide, lo que se dice en el vídeo o el texto de los slides. La transcripción
// va en segundo plano (como las demás) y se añade a la nota de la idea al terminar; el texto de los slides lo lee
// Claude mirando las imágenes.

const publico = (m) => Object.assign(new Error(m), { publico: true });
const primeraLinea = (t) => String(t || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
const recortar = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
const fecha = (f) => String(f || '').slice(0, 10);
const linea = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ');

export function createReferencias({ jarvis, competencia, ads, adjuntos, asistente, vaultPath, fetchImpl = fetch }) {
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
        const dir = path.join(vaultPath, '.jarvis', 'competencia', 'videos', String(m.id).replace(/[^\w-]/g, '_'));
        const f = path.join(dir, 'video.mp4');
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

  return { guardarComoIdea };
}
