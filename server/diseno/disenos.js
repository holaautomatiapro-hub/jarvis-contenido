// Diseños: de un guion a un carrusel o unas stories con el sistema de diseño del kit.
// Claude escribe el diseño (guardar_diseno en el MCP) → el motor dibuja la vista previa y revisa la calidad →
// la persona lo ajusta en el chat y lo exporta (JPG o MP4) a la biblioteca, desde donde se programa o publica.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { ajustes, row, rows } from '../db.js';
import { FORMATOS } from './kit.js';
import { normalizarDiseno } from './motor.js';
import { ESTILO_STORIES, ejemplosStories } from '../stories.js';

export class DisenoError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const ESTADOS = ['nuevo', 'generando', 'renderizando', 'listo', 'exportando', 'error'];
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const sha = (t) => createHash('sha1').update(t).digest('hex').slice(0, 16);
// Lo que hace que el kit dibuje distinto: su configuración y cuándo cambiaron sus archivos
function huellaKit(k) {
  const fechas = ['kit.json', ...(k.css || [])].map((f) => { try { return statSync(path.join(k.dir, f)).mtimeMs; } catch { return 0; } });
  return sha(JSON.stringify({ ...k, dir: null, fechas }));
}
// Una huella por diapositiva: si no cambia ni ella, ni su posición, ni el total, ni el kit, se dibuja igual
export function huellasDe(d, hk) {
  const total = d.slides.length;
  return d.slides.map((slide, i) => sha(JSON.stringify({ slide, n: i + 1, total, formato: d.formato, plantilla: d.plantilla, hk })));
}

export function createDisenos({ db, jarvis, kit, motor, archivos = null, previasDir, portadasDir = path.join(path.dirname(previasDir), 'portadas'), recortarFoto = null, asistente = null, emitir = () => {}, alCambiar = () => {} }) {
  const q = {
    get: db.prepare('SELECT * FROM disenos WHERE id = ?'),
    // Las portadas que se hacen desde una pieza no salen en la lista de Diseño
    // (las que no llegaron a la pieza, p. ej. porque se cerró la ventana antes de tiempo, sí: para no perderlas)
    lista: db.prepare("SELECT * FROM disenos WHERE uso IS NULL OR uso != 'portada' OR exportado IS NULL ORDER BY actualizado DESC, id DESC LIMIT 200"),
    del: db.prepare('DELETE FROM disenos WHERE id = ?'),
  };
  const actualizar = (id, campos) => {
    const claves = Object.keys(campos);
    db.prepare(`UPDATE disenos SET ${claves.map((k) => `${k} = ?`).join(', ')}, actualizado = datetime('now','localtime') WHERE id = ?`)
      .run(...claves.map((k) => campos[k] ?? null), id);
  };
  const leer = (id) => {
    const r = row(q.get, Number(id));
    if (!r) throw new DisenoError('Ese diseño no existe');
    return r;
  };

  // Las diapositivas que han cambiado desde la última exportación (solo esas se vuelven a exportar)
  function cambiadasDesdeExportar(r, hk) {
    const exp = json(r.exportado, null);
    const datos = json(r.datos, null);
    if (!exp?.huellas || !datos?.slides?.length || exp.huellas.length !== datos.slides.length) return null;
    const ahora = huellasDe(datos, hk ?? huellaKit(kit.leer()));
    return ahora.map((h, i) => (h !== exp.huellas[i] ? i + 1 : null)).filter(Boolean);
  }

  function vista(r, { conDatos = false, hk } = {}) {
    const datos = json(r.datos, null);
    const previas = json(r.previas, []);
    return {
      cambiadas: r.exportado ? cambiadasDesdeExportar(r, hk) : null,
      id: r.id, titulo: r.titulo, formato: r.formato, plantilla: r.plantilla, estado: r.estado, error: r.error, uso: r.uso || null,
      version: r.version, caption: r.caption || '', guion: r.guion || '', nota: r.nota, pieza_origen: r.pieza_origen,
      diapositivas: datos?.slides?.length || 0,
      previas: previas.map((f) => `/api/disenos/${r.id}/previas/${f}`),
      avisos: json(r.avisos, []), exportado: json(r.exportado, null), progreso: r.progreso ?? null, trabajo: trabajoDe(r),
      creado: r.creado, actualizado: r.actualizado,
      ...(conDatos ? { datos } : {}),
    };
  }
  const avisar = (id) => { emitir({ type: 'diseno', id }); alCambiar(); };

  const listar = () => { const hk = huellaKit(kit.leer()); return rows(q.lista).map((r) => vista(r, { hk })); };
  const obtener = (id, opciones) => vista(leer(id), opciones);

  // El guion puede venir pegado, de una nota del vault o de una pieza del pipeline (con su nota)
  function resolverGuion({ guion, nota, pieza_id }) {
    let texto = typeof guion === 'string' ? guion.trim() : '';
    let ruta = typeof nota === 'string' && nota.trim() ? nota.trim() : null;
    let pieza = null;
    if (pieza_id) {
      pieza = jarvis.listarPiezas().find((p) => p.id === Number(pieza_id));
      if (!pieza) throw new DisenoError('Esa pieza no existe');
      ruta = ruta || pieza.nota || null;
    }
    if (!texto && ruta) {
      try { texto = jarvis.vault.read(ruta).contenido || ''; } catch { throw new DisenoError(`No encuentro la nota del guion (${ruta})`); }
    }
    if (!texto && pieza) texto = [pieza.titulo, pieza.caption].filter(Boolean).join('\n\n');
    if (!texto) throw new DisenoError('Falta el guion: pégalo o elige una pieza o una nota con el guion');
    return { texto: texto.slice(0, 30_000), nota: ruta, pieza };
  }

  function crear({ titulo, formato = 'carrusel', plantilla, guion, nota, pieza_id, indicaciones, generar = true, uso = null } = {}) {
    const k = kit.leer();
    if (!FORMATOS[formato]) throw new DisenoError('El formato debe ser carrusel o story');
    const anuncio = uso === 'anuncio';
    const validas = k.plantillas.filter((p) => (anuncio ? p.anuncio : !p.anuncio));
    if (anuncio && !validas.length) throw new DisenoError('Tu sistema de diseño no tiene plantilla de anuncios. Importa uno que la tenga (Laboratorio → Diseño → Cambiar sistema).');
    const pl = validas.find((p) => p.id === plantilla) || validas.find((p) => p.formatos.includes(formato)) || k.plantillas.find((p) => p.id === plantilla) || k.plantillas.find((p) => p.formatos.includes(formato));
    if (!pl) throw new DisenoError('Tu sistema de diseño no tiene ninguna plantilla para ese formato');
    if (!pl.formatos.includes(formato)) throw new DisenoError(`La plantilla «${pl.nombre}» no tiene formato ${FORMATOS[formato].nombre.toLowerCase()}`);
    if (generar && !asistente) throw new DisenoError('El chat con Claude no está disponible');
    if (generar && asistente.estado().ocupado) throw new DisenoError('JARVIS está terminando otra petición (en Voz, Skills u otro diseño). Espera a que acabe y vuelve a pulsar Diseñar.');
    const g = resolverGuion({ guion, nota, pieza_id });
    const nombre = String(titulo || g.pieza?.titulo || g.texto.split('\n').find((l) => l.trim()) || 'Diseño').replace(/^#+\s*/, '').trim().slice(0, 160);
    const { lastInsertRowid } = db.prepare('INSERT INTO disenos (titulo, formato, plantilla, guion, nota, pieza_origen, uso) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(nombre, formato, pl.id, g.texto, g.nota, g.pieza?.id ?? null, anuncio ? 'anuncio' : null);
    const id = Number(lastInsertRowid);
    if (generar) generarConClaude(id, { indicaciones });
    else {
      // Lo crea Claude desde otra conversación (Replicar o el Chat) y lo va a diseñar ahora: se sigue igual
      const conversacion = asistente?.conversacionActiva?.();
      if (conversacion) seguir(id, { conversacion, version: 0 });
    }
    avisar(id);
    return obtener(id);
  }

  // ---------- Creativos para anuncios (Meta Ads → Creativos) ----------
  // imagen: 4:5 (feed), una diapositiva por variante · video: 9:16 (reels y stories), una diapositiva larga
  function crearAnuncio({ tipo = 'imagen', titulo, brief, oferta, palabra, variantes = 3, material = [], plantilla, pieza_id, indicaciones } = {}) {
    if (!['imagen', 'video'].includes(tipo)) throw new DisenoError('El creativo es imagen o vídeo');
    const b = String(brief || '').trim();
    if (b.length < 10 && !pieza_id) throw new DisenoError('Cuenta de qué va el anuncio: a quién se dirige, qué ofreces y el ángulo');
    const n = tipo === 'video' ? 1 : Math.min(6, Math.max(1, Math.round(Number(variantes) || 3)));
    const urls = (Array.isArray(material) ? material : []).map(String).filter((u) => u.startsWith('/api/contenido/archivos/')).slice(0, 12);
    const guion = [
      `# ${String(titulo || '').trim() || (tipo === 'video' ? 'Anuncio en vídeo' : 'Anuncio')}`,
      `Tipo: ${tipo === 'video' ? 'vídeo 9:16 (reels y stories)' : `imagen 4:5 (feed) · ${n} variante${n === 1 ? '' : 's'}`}`,
      b && `Brief: ${b.slice(0, 4000)}`,
      oferta && `Oferta: ${String(oferta).trim().slice(0, 500)}`,
      palabra && `Llamada a la acción / palabra clave: ${String(palabra).trim().slice(0, 100)}`,
      urls.length && `Material para usar: ${urls.join(', ')}`,
    ].filter(Boolean).join('\n');
    const guionPieza = pieza_id ? resolverGuion({ pieza_id }).texto : '';
    return crear({ titulo, formato: tipo === 'video' ? 'story' : 'carrusel', plantilla, guion: guionPieza ? `${guion}\n\nGuion o contenido de partida:\n${guionPieza}` : guion, indicaciones, uso: 'anuncio' });
  }

  function promptAnuncio(r, { indicaciones } = {}) {
    const k = kit.leer();
    const pl = k.plantillas.find((p) => p.id === r.plantilla);
    const video = r.formato === 'story';
    const n = Number((/(\d+) variantes?/.exec(r.guion) || [])[1]) || (video ? 1 : 3);
    return `Diseña el creativo de anuncio #${r.id} de JARVIS (Meta Ads).
- Formato: ${video ? 'vídeo vertical 9:16 (1080×1920) para reels y stories: UNA sola diapositiva con "duracion" = lo que dure el anuncio (15-45 s, máx. 60)' : `imagen 4:5 (1080×1350) para el feed: ${n} diapositiva${n === 1 ? '' : 's'}, y cada una es un anuncio distinto (otra variante del gancho, del ángulo o de la foto, con el mismo sistema) para probarlas a la vez`}
- Plantilla: ${pl?.nombre || r.plantilla} (id "${r.plantilla}")${pl?.guia ? `; su guía de anuncios: ${pl.guia} (léela entera: manda sobre lo de abajo)` : ''}
${indicaciones ? `- Indicaciones de la persona: ${String(indicaciones).slice(0, 2000)}\n` : ''}${instruccionLogo()}- Encargo:
"""
${r.guion}
"""

Lo que hace que un anuncio funcione (salvo que la guía diga otra cosa):
1. El gancho se entiende al primer vistazo${video ? ' y se ve ya en el fotograma 0' : ''}: una escena concreta y deseable o la pregunta que se hace el cliente, no un diagnóstico abstracto.
2. Una sola idea y una sola llamada a la acción, visible en el propio creativo.
3. Las palabras del cliente, sin jerga del sector. Texto grande y legible en el móvil.
4. Prueba real: la cara de la persona, capturas reales, frases y cifras literales. Nada inventado ni promesas que la guía prohíba.
5. ${video ? 'Si hay un testimonio o un vídeo hablando, que mande él (con data-audio) y que los gráficos animados acompañen lo que se dice; subtítulos palabra a palabra con subtitulos_video y subtitulos(…, { karaoke: true, claves: […] }); y un cierre con la llamada a la acción los últimos 3-5 s. Respeta la zona segura de las stories.' : 'Composición de anuncio, no de carrusel: sin paginación; el titular y la oferta se leen en un segundo.'}

Pasos: 1) ver_kit_diseno; lee con leer_archivo_kit la guía del kit${pl?.guia ? `, la guía de anuncios (${pl.guia})` : ''} y el ejemplo de esta plantilla más parecido a lo que vas a hacer; mira con Read las referencias si las hay;
2) material: el que diga el encargo y, si te sirve, listar_medios; si hace falta una foto que no existe, generar_foto (como mucho 3);
3) escribe el diseño y guárdalo con guardar_diseno (id ${r.id});
4) mira con Read TODAS las vistas previas${video ? ' y, con ver_fotogramas_diseno, 5-6 momentos del vídeo (el gancho en el segundo 0, los gráficos y el cierre)' : ''}; corrige lo que no esté al nivel de los ejemplos y vuelve a guardar (hasta 2 rondas);
5) en "caption" escribe los textos para Meta${video ? '' : ' de cada variante (VARIANTE 1, VARIANTE 2…)'}: «Texto principal:» (la primera frase, de unos 125 caracteres, es casi todo el anuncio: que enganche sola), «Titular:» (26-32 caracteres) y «Descripción:» (opcional);
6) termina con un resumen de 2-3 líneas: qué variante es cada una y si queda algún aviso.`;
  }

  // ---------- Claude ----------
  // Diseños en los que Claude está trabajando ahora (desde Diseño, Replicar o el Chat), para enseñar cómo va:
  // id → { version, conversacion, inicio, paso, senal (última vez que Claude hizo algo), herramienta, uso }
  const enCurso = new Map();
  const parados = new Set(); // exportaciones que se han mandado parar
  const aj = ajustes(db);
  // Los pasos de un diseño y la parte de la barra que ocupa cada uno (en %)
  const PASOS = {
    empezando: { texto: 'Empezando', desde: 0, hasta: 8 },
    kit: { texto: 'Estudiando tu sistema de diseño', desde: 8, hasta: 30 },
    escribiendo: { texto: 'Escribiendo las diapositivas', desde: 30, hasta: 72 },
    dibujando: { texto: 'Dibujando la vista previa', desde: 72, hasta: 82 },
    revisando: { texto: 'Revisando que todo quepa y corrigiendo', desde: 82, hasta: 97 },
  };
  const LEE_KIT = new Set(['ver_kit_diseno', 'leer_archivo_kit', 'listar_medios', 'Read', 'Glob', 'Grep']);
  // Cuánto suele tardar (la mediana de los últimos), para estimar lo que queda
  const claveDuracion = (uso) => (uso === 'portada' ? 'duraciones_portada' : 'duraciones_diseno');
  function estimado(uso) {
    const l = [...(aj.leer(claveDuracion(uso), []) || [])].sort((a, b) => a - b);
    if (!l.length) return uso === 'portada' ? 120_000 : 300_000;
    return l[Math.floor(l.length / 2)];
  }
  function apuntarDuracion(uso, ms) {
    if (!(ms > 1000)) return;
    aj.guardar(claveDuracion(uso), [...(aj.leer(claveDuracion(uso), []) || []), Math.round(ms)].slice(-8));
  }
  function seguir(id, { conversacion, version }) {
    const r = leer(id);
    enCurso.set(r.id, { version, conversacion, inicio: Date.now(), paso: 'empezando', senal: Date.now(), herramienta: null, uso: r.uso || null });
    actualizar(r.id, { estado: 'generando', error: null });
  }
  function trabajoDe(r) {
    const t = enCurso.get(r.id);
    if (!t) return null;
    const p = PASOS[t.paso];
    return { conversacion: t.conversacion, inicio: t.inicio, paso: t.paso, texto: p.texto, desde: p.desde, hasta: p.hasta, senal: t.senal, herramienta: t.herramienta, estimado: estimado(t.uso) };
  }

  function promptGenerar(r, { indicaciones } = {}) {
    const k = kit.leer();
    const pl = k.plantillas.find((p) => p.id === r.plantilla);
    const f = FORMATOS[r.formato];
    return `Diseña el diseño #${r.id} de JARVIS.
- Formato: ${f.nombre.toLowerCase()} (${f.ancho}×${f.alto} px)
- Plantilla: ${pl?.nombre || r.plantilla} (id "${r.plantilla}")
- Título: ${r.titulo}
${indicaciones ? `- Indicaciones de la persona: ${String(indicaciones).slice(0, 2000)}\n` : ''}${r.formato === 'story' && tieneEstiloStories() ? `- Mi guía de estilo de stories está en ${ESTILO_STORIES}: léela con Read antes de diseñar y síguela en lo visual (colores, letras, composición, dónde va cada cosa); manda sobre el ejemplo de la plantilla.\n` : ''}${instruccionLogo()}${r.formato === 'story' && ejemplosStories(jarvis.vault).length ? `- Mis stories de ejemplo (míralas TODAS con Read antes de diseñar y copia su estilo visual: composición, tipografías, tamaños, colores, fondos, dónde va el texto, cómo uso fotos y stickers; que las nuevas parezcan de la misma cuenta): ${ejemplosStories(jarvis.vault).map((e) => e.ruta).join(', ')}\n` : ''}- Guion${r.nota ? ` (nota ${r.nota})` : ''}:
"""
${r.guion}
"""

Pasos: 1) ver_kit_diseno; 2) lee con leer_archivo_kit la guía del kit y, de esta plantilla, el ejemplo que más se parezca a lo que vas a hacer (si hay muchos, no hace falta leerlos todos: mira sus nombres y la guía); mira con Read las referencias si las hay, y lee las piezas reutilizables que encajen (úsalas antes de inventar otra cosa); 3) si te sirve material propio (fotos, vídeos, capturas), listar_medios: el material real luce más que el inventado;
4) escribe el diseño y guárdalo con guardar_diseno (id ${r.id}), con su caption;
5) mira con Read TODAS las vistas previas que devuelve y júzgalas como un diseñador exigente frente al ejemplo de la plantilla: jerarquía y tamaño de los textos, aire y márgenes, alineación, contraste, que cada diapositiva dibuje la idea (no solo texto) y que parezcan de la misma cuenta. Mira también la animación a mitad con ver_fotogramas_diseno en las diapositivas con más movimiento (nada debe taparse ni cruzarse al entrar). Corrige lo que no esté a la altura del ejemplo y los avisos, y vuelve a guardar (hasta 2 rondas; mira solo las que cambies);
6) termina con un resumen de 2-3 líneas: qué hay en cada diapositiva y si queda algún aviso.`;
  }

  const tieneEstiloStories = () => { try { return Boolean(jarvis.vault.read(ESTILO_STORIES).contenido.trim()); } catch { return false; } };
  function generarConClaude(id, { indicaciones, prompt } = {}) {
    if (!asistente) throw new DisenoError('El chat con Claude no está disponible');
    // Antes de borrar la sesión del chat de Diseño: si JARVIS está ocupado, no se toca nada
    if (asistente.estado({ conversacion: 'diseno' }).ocupado) throw new DisenoError('JARVIS está terminando otra petición. Espera a que acabe y vuelve a probar.');
    const r = leer(id);
    asistente.nuevaSesion({ conversacion: 'diseno' });
    asistente.preguntar({ texto: prompt || (r.uso === 'anuncio' ? promptAnuncio : promptGenerar)(r, { indicaciones }), conversacion: 'diseno' });
    seguir(r.id, { conversacion: 'diseno', version: r.version });
    avisar(r.id);
    return obtener(r.id);
  }

  // Lo que va haciendo Claude: cada herramienta mueve el paso del diseño en el que trabaja (el último que empezó)
  // y, cuando termina, si no llegó a guardar nada, se avisa
  function alEventoClaude(e) {
    const mios = [...enCurso.entries()].filter(([, t]) => t.conversacion === e.conversacion);
    if (!mios.length) return;
    if (e.tipo === 'fin' || e.tipo === 'error') {
      for (const [id, t] of mios) terminar(id, t, e);
      return;
    }
    const [id, t] = mios.reduce((a, b) => (b[1].inicio >= a[1].inicio ? b : a));
    t.senal = Date.now();
    const antes = t.paso;
    if (e.tipo === 'herramienta') {
      t.herramienta = e.nombre || null;
      if (e.nombre === 'guardar_diseno') t.paso = 'dibujando';
      else if (LEE_KIT.has(e.nombre) && ['empezando', 'kit', 'escribiendo'].includes(t.paso)) t.paso = 'kit';
    } else if (e.tipo === 'resultado_herramienta') {
      if (t.paso === 'kit') t.paso = 'escribiendo';
      else if (t.paso === 'dibujando') t.paso = 'revisando';
    }
    // Para no recargar la página con cada trozo de texto: al cambiar de paso o de herramienta, o cada 10 s
    if (t.paso !== antes || e.tipo === 'herramienta' || Date.now() - (t.avisado || 0) > 10_000) { t.avisado = Date.now(); avisar(id); }
  }

  function terminar(id, t, e) {
    enCurso.delete(id);
    let r;
    try { r = leer(id); } catch { return; }
    const sinGuardar = r.version === t.version;
    if (!sinGuardar && e.tipo === 'fin') apuntarDuracion(t.uso, Date.now() - t.inicio);
    if (r.estado !== 'generando') { avisar(id); return; }
    // Si el último guardado no se pudo dibujar, ese error es el que hay que ver (p. ej. falta el navegador)
    const sinDibujar = !sinGuardar && r.error && !json(r.previas, []).length;
    const estado = sinDibujar || (sinGuardar && !r.version) ? 'error' : 'listo';
    actualizar(id, {
      estado,
      error: e.tipo === 'error' ? `Claude no ha podido terminar: ${e.mensaje || 'error'}` : sinGuardar ? 'Claude ha terminado sin guardar el diseño. Pídeselo en el chat.' : sinDibujar ? r.error : null,
    });
    avisar(id);
    if (estado === 'listo' && r.uso === 'portada' && r.pieza_origen) ponerPortada(id).catch((err) => actualizar(id, { error: `No se ha podido añadir la portada a la pieza: ${err.message}` }));
  }

  // La portada terminada va a su pieza: en un vídeo, como portada; en lo demás, como primera imagen
  const FORMATOS_VIDEO = ['Reel', 'Short', 'Reel split', 'B-roll'];
  async function ponerPortada(id) {
    const r = leer(id);
    const pieza = jarvis.listarPiezas().find((p) => p.id === r.pieza_origen);
    if (!pieza) return null;
    const archivo = await exportarPortada(id);
    const comoPortada = FORMATOS_VIDEO.includes(pieza.formato);
    if (comoPortada) jarvis.actualizarPieza(pieza.id, { portada: archivo });
    else if (!pieza.archivos.some((a) => a.path === archivo.path)) jarvis.actualizarPieza(pieza.id, { archivos: [archivo, ...pieza.archivos] });
    actualizar(id, { exportado: JSON.stringify({ ...json(leer(id).exportado, {}), aplicada: pieza.id }) });
    emitir({ type: 'portada', diseno: id, pieza: pieza.id, titulo: pieza.titulo, archivo, comoPortada });
    avisar(id);
    return archivo;
  }

  // ---------- Tu logo ----------
  // El logo de la marca va SIEMPRE como imagen (el archivo real): si Claude lo dibuja copiándolo de una referencia,
  // sale deformado. Se suben en «Generar portada» (se guardan en la biblioteca y se apuntan en .jarvis/portadas/logos.json)
  // y también valen los que haya en el sistema de diseño (archivos con «logo» en el nombre).
  const logosIndice = path.join(portadasDir, 'logos.json');
  const MAX_LOGOS = 4;
  function logos() {
    let l = [];
    try { l = JSON.parse(readFileSync(logosIndice, 'utf8')); } catch { /* ninguno */ }
    return (Array.isArray(l) ? l : []).filter((x) => x?.path && x?.url && (!archivos || archivos.existe(x.path)));
  }
  async function guardarLogo({ nombre, datos }) {
    if (!archivos) throw new DisenoError('La biblioteca no está disponible');
    if (!Buffer.isBuffer(datos) || !datos.length) throw new DisenoError('Sube el archivo de tu logo');
    if (datos.length > 10 * 1024 ** 2) throw new DisenoError('El logo pesa más de 10 MB');
    const e = String(nombre || '').split('.').pop().toLowerCase().replace('jpeg', 'jpg');
    if (!['png', 'webp', 'jpg'].includes(e)) throw new DisenoError('Sube el logo en PNG (mejor sin fondo), WebP o JPG');
    const actuales = logos();
    if (actuales.length >= MAX_LOGOS) throw new DisenoError(`Como mucho ${MAX_LOGOS} versiones del logo: quita alguna`);
    const a = await archivos.guardar(Readable.from([datos]), { nombre: String(nombre || `logo.${e}`).slice(0, 120), mime: '' });
    mkdirSync(portadasDir, { recursive: true });
    writeFileSync(logosIndice, JSON.stringify([...actuales, { path: a.path, url: a.url, nombre: a.nombre, mime: a.mime }], null, 2));
    return { logos: logos() };
  }
  function borrarLogo(rel) {
    const actuales = logos();
    const quitado = actuales.find((x) => x.path === rel);
    if (!quitado) throw new DisenoError('Ese logo ya no está');
    writeFileSync(logosIndice, JSON.stringify(actuales.filter((x) => x !== quitado), null, 2));
    archivos?.borrar(quitado.path);
    return { logos: logos() };
  }
  // Los del sistema de diseño: se ponen con una ruta relativa (las diapositivas cargan el kit como base)
  function logosDelKit() {
    let k;
    try { k = kit.leer(); } catch { return []; }
    if (!k.propio) return [];
    const out = [];
    const buscar = (dir, rel, nivel) => {
      let lista = [];
      try { lista = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of lista) {
        if (out.length >= 6 || d.name.startsWith('.') || d.name === 'node_modules') continue;
        const r = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory() && nivel < 3) buscar(path.join(dir, d.name), r, nivel + 1);
        else if (d.isFile() && /logo/i.test(r) && /\.(png|webp|jpe?g|svg)$/i.test(d.name)) out.push(r);
      }
    };
    buscar(k.dir, '', 0);
    return out;
  }
  // La instrucción para Claude (en portadas y en diseños)
  function instruccionLogo({ referencia = false } = {}) {
    const subidos = logos().map((x) => `${x.url} (${x.nombre})`);
    const delKit = logosDelKit().map((r) => `${r} (del sistema de diseño)`);
    const todos = [...subidos, ...delKit];
    const nunca = 'NUNCA lo dibujes ni lo imites con SVG, CSS, formas, trazos o letras';
    if (todos.length) {
      return `- Mi logo: usa SIEMPRE el archivo real con <img src> (${nunca}): ${todos.join(', ')}. ${referencia
        ? 'Si la referencia lleva el logo (de fondo, como marca de agua, en una esquina o junto al nombre), pon este archivo en el mismo sitio, con el mismo tamaño, recorte, giro, opacidad y color que allí'
        : 'Ponlo solo donde lo pida la guía o la plantilla (si la plantilla ya lo trae, déjalo como está)'}; para cambiarle el color o aclararlo usa CSS sobre la imagen (opacity, filter: brightness(0) invert(1), mix-blend-mode, mask-image con degradado). Si hay varias versiones, elige la que mejor se vea sobre el fondo.\n`;
    }
    return referencia
      ? `- Si la referencia lleva un logo o símbolo de marca, ${nunca}: déjalo fuera (si al lado va el nombre de la marca en texto, ese sí), y al terminar avisa de que puedo subir mi logo en «Generar portada» para que salga exacto.\n`
      : `- Logo: si la plantilla del kit ya lo trae, déjalo como está; si no, ${nunca}: sin el archivo, pon solo el nombre de la marca en texto.\n`;
  }

  // ---------- Portadas (desde una pieza: «Generar portada») ----------
  // Las plantillas de portada son TUS portadas de referencia (una imagen cada una): Claude copia su diseño
  // (composición, letras, colores, efectos) y solo cambia el texto y la foto, salvo que pidas otra cosa.
  // Viven en el vault (.jarvis/portadas/): portadas.json + una imagen por plantilla. De serie, Carrusel y Testimonio.
  const portadasIndice = path.join(portadasDir, 'portadas.json');
  const PORTADAS_BASE = [
    { id: 'carrusel', nombre: 'Carrusel', formato: 'carrusel', descripcion: 'La portada de tus carruseles' },
    { id: 'testimonio', nombre: 'Testimonio', formato: 'story', descripcion: 'Foto del cliente y una frase suya entre comillas' },
  ];
  const IMAGEN_REF = /\.(png|jpe?g|webp)$/i;
  function leerPlantillasPortada() {
    try { const l = JSON.parse(readFileSync(portadasIndice, 'utf8')); if (Array.isArray(l) && l.length) return l; } catch { /* de serie */ }
    return PORTADAS_BASE;
  }
  const imagenDe = (id) => { try { const f = readdirSync(portadasDir).find((n) => n.startsWith(`${id}.`) && IMAGEN_REF.test(n)); return f ? path.join(portadasDir, f) : null; } catch { return null; } };
  function tiposPortada() {
    return leerPlantillasPortada().map((t) => {
      const img = imagenDe(t.id);
      return { id: t.id, nombre: t.nombre, formato: FORMATOS[t.formato] ? t.formato : 'carrusel', descripcion: t.descripcion || '', muestra: img ? `/api/portadas/muestra/${encodeURIComponent(t.id)}?v=${Math.round(statSync(img).mtimeMs)}` : null };
    });
  }
  const muestraPortada = (id) => (/^[a-z0-9-]{1,40}$/.test(String(id)) ? imagenDe(id) : null);

  // Sube (o cambia) la imagen de una plantilla; si el id no existe, crea la plantilla con ese nombre y formato
  function guardarPlantillaPortada({ id, nombre, formato, ext, datos }) {
    if (!Buffer.isBuffer(datos) || !datos.length) throw new DisenoError('Sube la imagen de la portada de referencia');
    if (datos.length > 20 * 1024 ** 2) throw new DisenoError('La imagen pesa más de 20 MB');
    const e = String(ext || '').toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg');
    if (!['jpg', 'png', 'webp'].includes(e)) throw new DisenoError('Sube la imagen en jpg, png o webp');
    const lista = leerPlantillasPortada().map((t) => ({ ...t }));
    let t = lista.find((x) => x.id === id);
    if (!t) {
      const n = String(nombre || '').trim().slice(0, 40);
      if (!n) throw new DisenoError('Ponle nombre a la plantilla');
      const base = slug(n) || 'portada';
      let nid = base;
      for (let k = 2; lista.some((x) => x.id === nid); k++) nid = `${base}-${k}`;
      t = { id: nid, nombre: n, formato: FORMATOS[formato] ? formato : 'carrusel', descripcion: '' };
      lista.push(t);
    }
    mkdirSync(portadasDir, { recursive: true });
    for (const f of readdirSync(portadasDir)) if (f.startsWith(`${t.id}.`) && IMAGEN_REF.test(f)) rmSync(path.join(portadasDir, f), { force: true });
    writeFileSync(path.join(portadasDir, `${t.id}.${e}`), datos);
    writeFileSync(portadasIndice, JSON.stringify(lista, null, 2));
    return { tipos: tiposPortada() };
  }
  function borrarPlantillaPortada(id) {
    const lista = leerPlantillasPortada().filter((t) => t.id !== id);
    if (!lista.length) throw new DisenoError('Deja al menos una plantilla');
    const img = imagenDe(id);
    if (img) rmSync(img, { force: true });
    mkdirSync(portadasDir, { recursive: true });
    writeFileSync(portadasIndice, JSON.stringify(lista, null, 2));
    return { tipos: tiposPortada() };
  }

  async function crearPortada({ tipo, titulo, descripcion, foto, pieza, sinFondo = true } = {}) {
    const t = tiposPortada().find((x) => x.id === tipo);
    if (!t) throw new DisenoError('Elige una plantilla de portada');
    const ref = imagenDe(t.id);
    if (!ref) throw new DisenoError(`Sube primero la imagen de referencia de «${t.nombre}» (la portada en la que se tiene que basar)`);
    const tit = String(titulo || '').trim().slice(0, 160);
    if (!tit) throw new DisenoError('Escribe el título de la portada');
    if (!asistente) throw new DisenoError('El chat con Claude no está disponible');
    if (asistente.estado().ocupado) throw new DisenoError('JARVIS está terminando otra petición. Espera a que acabe y vuelve a pulsar Generar.');
    const k = kit.leer();
    const pl = k.plantillas.find((x) => x.formatos.includes(t.formato)) || k.plantillas[0];
    if (!pl) throw new DisenoError('Tu sistema de diseño no tiene plantillas');
    const formato = pl.formatos.includes(t.formato) ? t.formato : pl.formatos[0];
    const desc = String(descripcion || '').trim().slice(0, 2000);
    let f = foto?.url && /^image\//.test(String(foto.mime || 'image/')) ? { url: String(foto.url), nombre: String(foto.nombre || ''), path: foto.path || null, mime: foto.mime } : null;
    // La persona va recortada (sin fondo), como en las portadas de referencia: se recorta antes de diseñar
    let recortada = false, aviso = null;
    if (f && sinFondo !== false && f.path) {
      if (!recortarFoto) aviso = 'No he podido quitar el fondo de la foto: en el VPS ejecuta bash ~/instalar-vps.sh para preparar el Laboratorio.';
      else {
        try { const r = await recortarFoto(f); if (r?.url) { f = { ...r }; recortada = true; } } catch (e) { aviso = `No he podido quitar el fondo de la foto (${e.message}); se usa tal cual.`; }
      }
    }
    const medios = (Array.isArray(pieza?.archivos) ? pieza.archivos : []).filter((a) => a?.url).slice(0, 6).map((a) => `${a.url} (${/^video\//.test(a.mime || '') ? 'vídeo' : 'foto'})`);
    const guion = [tit, desc].filter(Boolean).join('\n\n');
    // Si la pieza ya existe, la portada se le añade sola al terminar (aunque se cierre la ventana)
    const { lastInsertRowid } = db.prepare("INSERT INTO disenos (titulo, formato, plantilla, guion, uso, pieza_origen) VALUES (?, ?, ?, ?, 'portada', ?)").run(tit, formato, pl.id, guion, Number(pieza?.id) || null);
    const id = Number(lastInsertRowid);
    const fmt = FORMATOS[formato];
    const prompt = `Diseña SOLO UNA PORTADA (una única diapositiva) en el diseño #${id} de JARVIS, copiando el diseño de mi portada de referencia.
- Plantilla de portada: ${t.nombre}. Referencia (mírala con Read antes de nada): ${ref}
- Formato: ${fmt.nombre.toLowerCase()} (${fmt.ancho}×${fmt.alto} px)${formato === 'story' ? ', respetando las zonas seguras de arriba y abajo' : ''}
- Título: ${tit}
${desc ? `- Qué quiero: ${desc}\n` : ''}${f ? (recortada
      ? `- Foto (YA SIN FONDO, PNG transparente con la persona recortada; ponla tal cual en <img src>): ${f.url}. Colócala como la persona de la referencia (mismo tamaño, posición y encuadre, con el mismo resplandor o luz detrás y el mismo fundido abajo), nunca dentro de un recuadro ni con fondo.\n`
      : `- Foto que quiero usar (ponla tal cual en <img src>): ${f.url}.${sinFondo !== false ? ' Tiene fondo: intégrala lo más parecido a la referencia (sin recuadro; difumina sus bordes con una máscara o degradado hacia el fondo).' : ''}\n`) : ''}${instruccionLogo({ referencia: true })}${pieza?.titulo ? `- Es la portada de la pieza «${pieza.titulo}» (${pieza.formato || 'pieza'}).${medios.length ? ` Sus archivos (puedes usar una foto o un fotograma de un vídeo si encaja): ${medios.join(', ')}` : ''}\n` : ''}
Cómo: reproduce la referencia lo más fiel posible: misma composición y jerarquía, mismas tipografías (o las más parecidas de Google Fonts), mismos colores, mismos efectos (brillos, resplandores, degradados, fondos), mismo tipo de comillas, subrayados y marca (el logo, con su archivo: nunca dibujado); solo cambian el texto${f ? ' y la foto' : ''}. Si en «Qué quiero» pido algo distinto (por ejemplo, fondo blanco con letras negras), eso manda sobre la referencia. Usa la plantilla "${pl.id}" del kit solo como soporte técnico (tamaño, fuentes y CSS base); el aspecto es el de la referencia. Sin paginación ni cierre.
Pasos: 1) Read de la referencia; 2) ver_kit_diseno (formato técnico de las diapositivas); 3) escribe la diapositiva y guárdala con guardar_diseno (id ${id}); 4) mira la vista previa con Read, compárala con la referencia y corrige lo que no se parezca (y los avisos); 5) termina con una línea diciendo qué has puesto.`;
    generarConClaude(id, { prompt });
    return { ...obtener(id), aviso, fotoSinFondo: recortada ? f : null };
  }

  // Exporta la portada a JPG en la biblioteca y devuelve el archivo (el editor la pone en la pieza)
  async function exportarPortada(id) {
    if (!archivos) throw new DisenoError('La biblioteca no está disponible');
    const r = leer(id);
    const datos = json(r.datos, null);
    if (!datos?.slides?.length) throw new DisenoError('La portada aún no está lista');
    const previo = json(r.exportado, null);
    if (previo?.archivo && r.estado === 'listo' && previo.version === r.version) return previo.archivo;
    const res = await motor.exportar({ ...datos, slides: datos.slides.slice(0, 1) }, 'jpg', { alProgreso: () => {} });
    try {
      const a = res.archivos[0];
      const fuente = a.ruta ? createReadStream(a.ruta) : Readable.from([a.buffer]);
      const archivo = await archivos.guardar(fuente, { nombre: `portada-${slug(r.titulo).replace(/^portada-?/, '') || 'pieza'}.jpg`, mime: 'image/jpeg' });
      actualizar(r.id, { exportado: JSON.stringify({ tipo: 'portada', en: new Date().toISOString(), version: r.version, archivo }) });
      return archivo;
    } finally { res?.limpiar?.(); }
  }

  // ---------- Guardar (lo llama guardar_diseno) y vista previa ----------
  async function guardarDatos(id, datos) {
    const r = leer(id);
    if (r.estado === 'exportando') throw new DisenoError('Espera a que termine la exportación');
    const k = kit.leer();
    const spec = { formato: r.formato, plantilla: r.plantilla, titulo: r.titulo, caption: r.caption, ...(datos || {}) };
    let d;
    try { d = normalizarDiseno(spec, k); } catch (e) { throw new DisenoError(e.message); }
    const version = r.version + 1;
    const anterior = r.estado;
    actualizar(r.id, { estado: 'renderizando', titulo: d.titulo, formato: d.formato, plantilla: d.plantilla, caption: d.caption, datos: JSON.stringify(d), version });
    avisar(r.id);
    try {
      const dir = path.join(previasDir, String(r.id));
      mkdirSync(dir, { recursive: true });
      // Solo se dibujan las diapositivas que han cambiado; las demás conservan su vista previa y sus avisos
      const huellas = huellasDe(d, huellaKit(k));
      const antes = { huellas: json(r.huellas, []), previas: json(r.previas, []), avisos: json(r.avisos, []) };
      const iguales = huellas.map((h, i) => h === antes.huellas[i] && antes.previas[i] && existsSync(path.join(dir, antes.previas[i])));
      const solo = huellas.map((_, i) => i + 1).filter((n) => !iguales[n - 1]);
      const res = solo.length ? await motor.previsualizar(d, solo.length === huellas.length ? {} : { solo }) : { imagenes: huellas.map(() => null), avisos: [] };
      const nombres = huellas.map((_, i) => {
        if (iguales[i]) return antes.previas[i];
        const f = `v${version}-${String(i + 1).padStart(2, '0')}.jpg`;
        writeFileSync(path.join(dir, f), res.imagenes[i]);
        return f;
      });
      // Fuera las vistas previas viejas; la carpeta «fotogramas» (ver_fotogramas_diseno) se deja
      for (const f of readdirSync(dir)) if (!nombres.includes(f) && f !== 'fotogramas') rmSync(path.join(dir, f), { force: true, recursive: true });
      const avisos = [...antes.avisos.filter((a) => iguales[a.diapositiva - 1]), ...res.avisos].sort((a, b) => a.diapositiva - b.diapositiva);
      res.avisos = avisos;
      res.redibujadas = solo;
      const sigueGenerando = enCurso.has(r.id);
      actualizar(r.id, { estado: sigueGenerando ? 'generando' : 'listo', previas: JSON.stringify(nombres), avisos: JSON.stringify(avisos), huellas: JSON.stringify(huellas), error: null });
      avisar(r.id);
      return {
        id: r.id, version, diapositivas: nombres.length,
        redibujadas: res.redibujadas.length === nombres.length ? 'todas' : res.redibujadas,
        avisos: res.avisos.length ? res.avisos.map((a) => `Diapositiva ${a.diapositiva}: ${a.texto}`) : ['Sin avisos: todo cabe y nada se pisa.'],
        vistas_previas: nombres.map((f) => path.join(dir, f)),
      };
    } catch (e) {
      actualizar(r.id, { estado: anterior === 'generando' ? 'generando' : 'error', previas: '[]', avisos: '[]', huellas: '[]', error: `No se ha podido dibujar: ${e.message}` });
      avisar(r.id);
      throw new DisenoError(`No se ha podido dibujar el diseño: ${e.message}`);
    }
  }

  // Fotogramas de una diapositiva a mitad de animación: se guardan junto a las vistas previas (no cuentan como versión)
  async function fotogramas(id, { diapositiva, segundos } = {}) {
    const r = leer(id);
    const d = json(r.datos, null);
    if (!d?.slides?.length) throw new DisenoError('Ese diseño aún no tiene diapositivas: guárdalo primero con guardar_diseno');
    const n = Number(diapositiva);
    if (!Number.isInteger(n) || n < 1 || n > d.slides.length) throw new DisenoError(`La diapositiva tiene que estar entre 1 y ${d.slides.length}`);
    const lista = (Array.isArray(segundos) && segundos.length ? segundos : [1, 2.5, 4]).slice(0, 6).map(Number).filter(Number.isFinite);
    let res;
    try { res = await motor.fotogramas(d, n, lista); } catch (e) { throw new DisenoError(`No se ha podido dibujar: ${e.message}`); }
    const dir = path.join(previasDir, String(r.id), 'fotogramas');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return {
      diapositiva: n,
      fotogramas: res.map((f) => {
        const ruta = path.join(dir, `d${n}-${f.segundo.toFixed(1).replace('.', '_')}s.jpg`);
        writeFileSync(ruta, f.buffer);
        return { segundo: f.segundo, ruta };
      }),
    };
  }

  // Un diseño con diapositivas guardadas pero sin vistas previas (el dibujo falló o se borró): se vuelven a dibujar
  function redibujar(id) {
    const r = leer(id);
    const d = json(r.datos, null);
    if (!d?.slides?.length) throw new DisenoError('Este diseño aún no tiene diapositivas');
    if (['generando', 'renderizando', 'exportando'].includes(r.estado)) throw new DisenoError('Espera a que termine lo que está haciendo');
    return guardarDatos(r.id, { titulo: r.titulo, caption: r.caption, slides: d.slides });
  }

  // ---------- Exportar a la biblioteca ----------
  // Si ya se exportó en el mismo formato, solo se vuelven a sacar las diapositivas que han cambiado (o las que
  // elija la persona en «solo»); las demás se quedan como estaban en la biblioteca. «todo» las saca todas.
  function exportar(id, { tipo = 'jpg', solo = null, todo = false } = {}) {
    if (!archivos) throw new DisenoError('La biblioteca no está disponible');
    if (!['jpg', 'mp4'].includes(tipo)) throw new DisenoError('Exporta en jpg o mp4');
    const r = leer(id);
    const datos = json(r.datos, null);
    if (!datos?.slides?.length) throw new DisenoError('Este diseño aún no tiene diapositivas');
    // Mientras Claude diseña solo puede exportarlo él mismo (al replicar, lo exporta al terminar)
    if (['exportando', 'renderizando'].includes(r.estado) || (r.estado === 'generando' && !enCurso.has(r.id))) throw new DisenoError('Espera a que termine lo que está haciendo');
    const total = datos.slides.length;
    const huellas = huellasDe(datos, huellaKit(kit.leer()));
    const previo = json(r.exportado, null);
    const reutilizable = !todo && previo?.tipo === tipo && previo.archivos?.length === total && previo.huellas?.length === total && previo.archivos.every((a) => a?.path && archivos.existe(a.path));
    let rehacer = huellas.map((_, i) => i + 1);
    if (reutilizable) {
      const elegidas = Array.isArray(solo) ? [...new Set(solo.map(Number))].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b) : null;
      rehacer = elegidas?.length ? elegidas : rehacer.filter((n) => huellas[n - 1] !== previo.huellas[n - 1]);
      if (!rehacer.length) throw new DisenoError('No ha cambiado nada desde la última exportación: marca las diapositivas que quieras volver a exportar');
    }
    actualizar(r.id, { estado: 'exportando', error: null, progreso: 0 });
    avisar(r.id);
    parados.delete(r.id);
    let ultimo = 0;
    const siParado = () => { if (parados.has(r.id)) throw new DisenoError('Parada'); };
    (async () => {
      let res;
      try {
        res = await motor.exportar(datos, tipo, { solo: rehacer.length === total ? null : rehacer, alProgreso: ({ avance }) => {
          siParado();
          const p = Math.round(avance * 100);
          if (p - ultimo < 3 && p < 100) return;
          ultimo = p;
          actualizar(r.id, { progreso: p });
          emitir({ type: 'diseno', id: r.id, progreso: p });
        } });
        siParado();
        const guardados = reutilizable ? [...previo.archivos] : [];
        for (const [i, a] of res.archivos.entries()) {
          const fuente = a.ruta ? createReadStream(a.ruta) : Readable.from([a.buffer]);
          guardados[(a.n ?? rehacer[i]) - 1] = await archivos.guardar(fuente, { nombre: `${slug(r.titulo)}-${a.nombre}`, mime: a.mime });
        }
        const exportado = { tipo, en: new Date().toISOString(), piezas: aLaBiblioteca(r, datos, guardados), huellas, archivos: guardados, rehechas: rehacer.length === total ? 'todas' : rehacer };
        actualizar(r.id, { estado: 'listo', exportado: JSON.stringify(exportado), progreso: null });
      } catch (e) {
        // Parada desde «Trabajando»: se queda como estaba (lo exportado antes sigue valiendo)
        actualizar(r.id, { estado: 'listo', error: parados.has(r.id) ? null : `No se ha podido exportar: ${e.message}`, progreso: null });
      } finally {
        parados.delete(r.id);
        res?.limpiar?.();
        avisar(r.id);
      }
    })();
    return obtener(r.id);
  }

  // Corta una exportación en marcha en cuanto termina el fotograma que está sacando
  function pararExportacion(id) {
    const r = leer(id);
    if (r.estado !== 'exportando') throw new DisenoError('Ya ha terminado de exportar');
    parados.add(r.id);
    return { ok: true };
  }

  // Carrusel → una pieza (la del guion si sale de una, o la que ya se exportó antes si no está publicada).
  // Stories → una pieza por story, juntas en una carpeta con el nombre del diseño.
  function aLaBiblioteca(r, datos, guardados) {
    const piezas = jarvis.listarPiezas();
    const libre = (pid) => { const p = piezas.find((x) => x.id === pid); return p && p.estado !== 'publicado' && p.ig_estado !== 'publicado' && p.ig_estado !== 'procesando' ? p : null; };
    const previas = json(r.exportado, null)?.piezas || [];
    const sustituidos = [];
    let ids;
    // Lo nuevo hereda la estrategia de la pieza del guion y queda enlazado a ella (o al diseño, si no sale de una pieza)
    const origen = r.pieza_origen ? piezas.find((x) => x.id === r.pieza_origen) : null;
    const enlace = origen ? { padre_id: origen.id, pilar: origen.pilar, objetivo: origen.objetivo } : { origen_ref: `Diseño #${r.id} · ${r.titulo}` };
    if (r.uso === 'anuncio') {
      // Un creativo → una pieza «Anuncio» con todas sus variantes y los textos para Meta, en la carpeta Anuncios
      const destino = libre(previas[0]);
      const campos = { titulo: r.titulo, formato: 'Anuncio', estado: 'listo', caption: datos.caption || r.caption || null, archivos: guardados, carpeta: 'Anuncios' };
      if (destino) { sustituidos.push(...destino.archivos); ids = [jarvis.actualizarPieza(destino.id, campos).id]; }
      else ids = [jarvis.crearPieza({ ...campos, ...enlace, origen: 'dashboard' }).id];
    } else if (r.formato === 'carrusel') {
      const destino = libre(previas[0]) || libre(r.pieza_origen);
      const campos = { titulo: r.titulo, formato: 'Carrusel', estado: 'listo', caption: datos.caption || r.caption || null, archivos: guardados };
      if (destino) { sustituidos.push(...destino.archivos); ids = [jarvis.actualizarPieza(destino.id, campos).id]; }
      else ids = [jarvis.crearPieza({ ...campos, ...enlace, origen: 'dashboard' }).id];
    } else {
      ids = guardados.map((a, i) => {
        const campos = { titulo: `${r.titulo} · ${i + 1}/${guardados.length}`, formato: 'Story', estado: 'listo', archivos: [a] };
        const destino = previas.length === guardados.length ? libre(previas[i]) : null;
        if (destino) { sustituidos.push(...destino.archivos); return jarvis.actualizarPieza(destino.id, campos).id; }
        return jarvis.crearPieza({ ...campos, ...enlace, origen: 'dashboard', registrarActividad: i === 0 }).id;
      });
      jarvis.moverACarpeta(ids, r.titulo.slice(0, 80));
      if (r.pieza_origen && libre(r.pieza_origen)) jarvis.actualizarPieza(r.pieza_origen, { estado: 'listo' });
    }
    // Los archivos de la exportación anterior se borran si ya no los usa ninguna pieza
    const enUso = new Set(jarvis.listarPiezas().flatMap((p) => p.archivos.map((a) => a.path)));
    for (const a of sustituidos) if (a.path && !enUso.has(a.path)) archivos.borrar(a.path);
    return ids;
  }

  function borrar(id) {
    const r = leer(id);
    if (r.estado === 'exportando') throw new DisenoError('Espera a que termine la exportación');
    q.del.run(r.id);
    rmSync(path.join(previasDir, String(r.id)), { recursive: true, force: true });
    enCurso.delete(r.id);
    avisar(r.id);
    return { ok: true };
  }

  function rutaPrevia(id, fichero) {
    if (!/^v\d+-\d{2}\.jpg$/.test(String(fichero))) return null;
    const abs = path.join(previasDir, String(Number(id)), fichero);
    return existsSync(abs) ? abs : null;
  }

  // Al arrancar: lo que se quedó a medias (JARVIS se cerró) vuelve a estar disponible
  db.prepare("UPDATE disenos SET estado = CASE WHEN version > 0 THEN 'listo' ELSE 'error' END, error = CASE WHEN version > 0 THEN error ELSE 'Se interrumpió al cerrar JARVIS' END, progreso = NULL WHERE estado IN ('generando', 'renderizando', 'exportando')").run();

  // ---------- Otra versión de lo exportado (Contenido → «Generar vídeo» / «Generar imagen») ----------
  // El diseño del que sale una pieza (si sale de uno): para sacar su versión en vídeo o en imagen
  function deLaPieza(piezaId) {
    const pid = Number(piezaId);
    for (const r of rows(db.prepare("SELECT * FROM disenos WHERE exportado IS NOT NULL AND (uso IS NULL OR uso != 'portada') ORDER BY id DESC"))) {
      const exp = json(r.exportado, null);
      const i = (exp?.piezas || []).indexOf(pid);
      if (i >= 0 && json(r.datos, null)?.slides?.length) return { id: r.id, formato: r.formato, tipo: exp.tipo, indice: i };
    }
    return null;
  }
  // Saca los archivos en el otro formato sin tocar la pieza ni la exportación del diseño (se añaden a la pieza si se eligen)
  async function otraVersion(id, tipo, { solo = null, alProgreso = () => {} } = {}) {
    const r = leer(id);
    const datos = json(r.datos, null);
    const res = await motor.exportar(datos, tipo, { solo, alProgreso });
    try {
      const guardados = [];
      for (const a of res.archivos) {
        const fuente = a.ruta ? createReadStream(a.ruta) : Readable.from([a.buffer]);
        guardados.push(await archivos.guardar(fuente, { nombre: `${slug(r.titulo)}-${a.nombre}`, mime: a.mime }));
      }
      return { archivos: guardados };
    } finally { res?.limpiar?.(); }
  }
  // Lo que se está haciendo ahora con los diseños (para «Trabajando en…» de la barra de arriba)
  function trabajos() {
    const ids = new Set([...enCurso.keys(), ...rows(db.prepare("SELECT id FROM disenos WHERE estado IN ('exportando', 'renderizando')")).map((x) => x.id)]);
    return [...ids].map((id) => { try { return vista(leer(id)); } catch { return null; } }).filter(Boolean);
  }

  return { listar, obtener, crear, crearAnuncio, generar: generarConClaude, trabajos, pararExportacion, deLaPieza, otraVersion, alEventoClaude, guardarDatos, redibujar, fotogramas, exportar, borrar, rutaPrevia, tiposPortada, muestraPortada, guardarPlantillaPortada, borrarPlantillaPortada, crearPortada, exportarPortada, logos, guardarLogo, borrarLogo, ESTADOS };
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'diseno';
