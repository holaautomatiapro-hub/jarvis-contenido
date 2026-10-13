// Diseños: de un guion a un carrusel o unas stories con el sistema de diseño del kit.
// Claude escribe el diseño (guardar_diseno en el MCP) → el motor dibuja la vista previa y revisa la calidad →
// la persona lo ajusta en el chat y lo exporta (JPG o MP4) a la biblioteca, desde donde se programa o publica.
import path from 'node:path';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { ajustes, row, rows } from '../db.js';
import { FORMATOS } from './kit.js';
import { normalizarDiseno } from './motor.js';

export class DisenoError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const ESTADOS = ['nuevo', 'generando', 'renderizando', 'listo', 'exportando', 'error'];
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };

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

  function vista(r, { conDatos = false } = {}) {
    const datos = json(r.datos, null);
    const previas = json(r.previas, []);
    return {
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

  const listar = () => rows(q.lista).map((r) => vista(r));
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

  function crear({ titulo, formato = 'carrusel', plantilla, guion, nota, pieza_id, indicaciones, generar = true } = {}) {
    const k = kit.leer();
    if (!FORMATOS[formato]) throw new DisenoError('El formato debe ser carrusel o story');
    const pl = k.plantillas.find((p) => p.id === plantilla) || k.plantillas.find((p) => p.formatos.includes(formato));
    if (!pl) throw new DisenoError('Tu sistema de diseño no tiene ninguna plantilla para ese formato');
    if (!pl.formatos.includes(formato)) throw new DisenoError(`La plantilla «${pl.nombre}» no tiene formato ${FORMATOS[formato].nombre.toLowerCase()}`);
    if (generar && !asistente) throw new DisenoError('El chat con Claude no está disponible');
    if (generar && asistente.estado().ocupado) throw new DisenoError('JARVIS está terminando otra petición (en Voz, Skills u otro diseño). Espera a que acabe y vuelve a pulsar Diseñar.');
    const g = resolverGuion({ guion, nota, pieza_id });
    const nombre = String(titulo || g.pieza?.titulo || g.texto.split('\n').find((l) => l.trim()) || 'Diseño').replace(/^#+\s*/, '').trim().slice(0, 160);
    const { lastInsertRowid } = db.prepare('INSERT INTO disenos (titulo, formato, plantilla, guion, nota, pieza_origen) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nombre, formato, pl.id, g.texto, g.nota, g.pieza?.id ?? null);
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

  // ---------- Claude ----------
  // Diseños en los que Claude está trabajando ahora (desde Diseño, Replicar o el Chat), para enseñar cómo va:
  // id → { version, conversacion, inicio, paso, senal (última vez que Claude hizo algo), herramienta, uso }
  const enCurso = new Map();
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
${indicaciones ? `- Indicaciones de la persona: ${String(indicaciones).slice(0, 2000)}\n` : ''}- Guion${r.nota ? ` (nota ${r.nota})` : ''}:
"""
${r.guion}
"""

Pasos: 1) ver_kit_diseno; 2) lee con Read la guía del kit y el ejemplo de esta plantilla; 3) si te sirve material propio (fotos o vídeos), listar_medios;
4) escribe el diseño y guárdalo con guardar_diseno (id ${r.id}), con su caption; 5) corrige los avisos que te devuelva y vuelve a guardar;
6) termina con un resumen de 2-3 líneas: qué hay en cada diapositiva y si queda algún aviso.`;
  }

  function generarConClaude(id, { indicaciones, prompt } = {}) {
    if (!asistente) throw new DisenoError('El chat con Claude no está disponible');
    // Antes de borrar la sesión del chat de Diseño: si JARVIS está ocupado, no se toca nada
    if (asistente.estado({ conversacion: 'diseno' }).ocupado) throw new DisenoError('JARVIS está terminando otra petición. Espera a que acabe y vuelve a probar.');
    const r = leer(id);
    asistente.nuevaSesion({ conversacion: 'diseno' });
    asistente.preguntar({ texto: prompt || promptGenerar(r, { indicaciones }), conversacion: 'diseno' });
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
    actualizar(id, {
      estado: sinDibujar || (sinGuardar && !r.version) ? 'error' : 'listo',
      error: e.tipo === 'error' ? `Claude no ha podido terminar: ${e.mensaje || 'error'}` : sinGuardar ? 'Claude ha terminado sin guardar el diseño. Pídeselo en el chat.' : sinDibujar ? r.error : null,
    });
    avisar(id);
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
    const { lastInsertRowid } = db.prepare("INSERT INTO disenos (titulo, formato, plantilla, guion, uso) VALUES (?, ?, ?, ?, 'portada')").run(tit, formato, pl.id, guion);
    const id = Number(lastInsertRowid);
    const fmt = FORMATOS[formato];
    const prompt = `Diseña SOLO UNA PORTADA (una única diapositiva) en el diseño #${id} de JARVIS, copiando el diseño de mi portada de referencia.
- Plantilla de portada: ${t.nombre}. Referencia (mírala con Read antes de nada): ${ref}
- Formato: ${fmt.nombre.toLowerCase()} (${fmt.ancho}×${fmt.alto} px)${formato === 'story' ? ', respetando las zonas seguras de arriba y abajo' : ''}
- Título: ${tit}
${desc ? `- Qué quiero: ${desc}\n` : ''}${f ? (recortada
      ? `- Foto (YA SIN FONDO, PNG transparente con la persona recortada; ponla tal cual en <img src>): ${f.url}. Colócala como la persona de la referencia (mismo tamaño, posición y encuadre, con el mismo resplandor o luz detrás y el mismo fundido abajo), nunca dentro de un recuadro ni con fondo.\n`
      : `- Foto que quiero usar (ponla tal cual en <img src>): ${f.url}.${sinFondo !== false ? ' Tiene fondo: intégrala lo más parecido a la referencia (sin recuadro; difumina sus bordes con una máscara o degradado hacia el fondo).' : ''}\n`) : ''}${pieza?.titulo ? `- Es la portada de la pieza «${pieza.titulo}» (${pieza.formato || 'pieza'}).${medios.length ? ` Sus archivos (puedes usar una foto o un fotograma de un vídeo si encaja): ${medios.join(', ')}` : ''}\n` : ''}
Cómo: reproduce la referencia lo más fiel posible: misma composición y jerarquía, mismas tipografías (o las más parecidas de Google Fonts), mismos colores, mismos efectos (brillos, resplandores, degradados, fondos), mismo tipo de comillas, subrayados y marca; solo cambian el texto${f ? ' y la foto' : ''}. Si en «Qué quiero» pido algo distinto (por ejemplo, fondo blanco con letras negras), eso manda sobre la referencia. Usa la plantilla "${pl.id}" del kit solo como soporte técnico (tamaño, fuentes y CSS base); el aspecto es el de la referencia. Sin paginación ni cierre.
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
      const res = await motor.previsualizar(d);
      const dir = path.join(previasDir, String(r.id));
      mkdirSync(dir, { recursive: true });
      const nombres = res.imagenes.map((buf, i) => {
        const f = `v${version}-${String(i + 1).padStart(2, '0')}.jpg`;
        writeFileSync(path.join(dir, f), buf);
        return f;
      });
      for (const f of readdirSync(dir)) if (!nombres.includes(f)) rmSync(path.join(dir, f), { force: true });
      const sigueGenerando = enCurso.has(r.id);
      actualizar(r.id, { estado: sigueGenerando ? 'generando' : 'listo', previas: JSON.stringify(nombres), avisos: JSON.stringify(res.avisos), error: null });
      avisar(r.id);
      return {
        id: r.id, version, diapositivas: nombres.length,
        avisos: res.avisos.length ? res.avisos.map((a) => `Diapositiva ${a.diapositiva}: ${a.texto}`) : ['Sin avisos: todo cabe y nada se pisa.'],
        vistas_previas: nombres.map((f) => path.join(dir, f)),
      };
    } catch (e) {
      actualizar(r.id, { estado: anterior === 'generando' ? 'generando' : 'error', previas: '[]', avisos: '[]', error: `No se ha podido dibujar: ${e.message}` });
      avisar(r.id);
      throw new DisenoError(`No se ha podido dibujar el diseño: ${e.message}`);
    }
  }

  // ---------- Exportar a la biblioteca ----------
  function exportar(id, { tipo = 'jpg' } = {}) {
    if (!archivos) throw new DisenoError('La biblioteca no está disponible');
    if (!['jpg', 'mp4'].includes(tipo)) throw new DisenoError('Exporta en jpg o mp4');
    const r = leer(id);
    const datos = json(r.datos, null);
    if (!datos?.slides?.length) throw new DisenoError('Este diseño aún no tiene diapositivas');
    // Mientras Claude diseña solo puede exportarlo él mismo (al replicar, lo exporta al terminar)
    if (['exportando', 'renderizando'].includes(r.estado) || (r.estado === 'generando' && !enCurso.has(r.id))) throw new DisenoError('Espera a que termine lo que está haciendo');
    actualizar(r.id, { estado: 'exportando', error: null, progreso: 0 });
    avisar(r.id);
    let ultimo = 0;
    (async () => {
      let res;
      try {
        res = await motor.exportar(datos, tipo, { alProgreso: ({ avance }) => {
          const p = Math.round(avance * 100);
          if (p - ultimo < 3 && p < 100) return;
          ultimo = p;
          actualizar(r.id, { progreso: p });
          emitir({ type: 'diseno', id: r.id, progreso: p });
        } });
        const guardados = [];
        for (const a of res.archivos) {
          const fuente = a.ruta ? createReadStream(a.ruta) : Readable.from([a.buffer]);
          guardados.push(await archivos.guardar(fuente, { nombre: `${slug(r.titulo)}-${a.nombre}`, mime: a.mime }));
        }
        const exportado = { tipo, en: new Date().toISOString(), piezas: aLaBiblioteca(r, datos, guardados) };
        actualizar(r.id, { estado: 'listo', exportado: JSON.stringify(exportado), progreso: null });
      } catch (e) {
        actualizar(r.id, { estado: 'listo', error: `No se ha podido exportar: ${e.message}`, progreso: null });
      } finally {
        res?.limpiar?.();
        avisar(r.id);
      }
    })();
    return obtener(r.id);
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
    if (r.formato === 'carrusel') {
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

  return { listar, obtener, crear, generar: generarConClaude, alEventoClaude, guardarDatos, exportar, borrar, rutaPrevia, tiposPortada, muestraPortada, guardarPlantillaPortada, borrarPlantillaPortada, crearPortada, exportarPortada, ESTADOS };
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'diseno';
