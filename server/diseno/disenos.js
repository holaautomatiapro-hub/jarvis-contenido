// Diseños: de un guion a un carrusel o unas stories con el sistema de diseño del kit.
// Claude escribe el diseño (guardar_diseno en el MCP) → el motor dibuja la vista previa y revisa la calidad →
// la persona lo ajusta en el chat y lo exporta (JPG o MP4) a la biblioteca, desde donde se programa o publica.
import path from 'node:path';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { row, rows } from '../db.js';
import { FORMATOS } from './kit.js';
import { normalizarDiseno } from './motor.js';

export class DisenoError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const ESTADOS = ['nuevo', 'generando', 'renderizando', 'listo', 'exportando', 'error'];
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };

export function createDisenos({ db, jarvis, kit, motor, archivos = null, previasDir, asistente = null, emitir = () => {}, alCambiar = () => {} }) {
  const q = {
    get: db.prepare('SELECT * FROM disenos WHERE id = ?'),
    lista: db.prepare('SELECT * FROM disenos ORDER BY actualizado DESC, id DESC LIMIT 200'),
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
      id: r.id, titulo: r.titulo, formato: r.formato, plantilla: r.plantilla, estado: r.estado, error: r.error,
      version: r.version, caption: r.caption || '', guion: r.guion || '', nota: r.nota, pieza_origen: r.pieza_origen,
      diapositivas: datos?.slides?.length || 0,
      previas: previas.map((f) => `/api/disenos/${r.id}/previas/${f}`),
      avisos: json(r.avisos, []), exportado: json(r.exportado, null), progreso: r.progreso ?? null,
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
    avisar(id);
    return obtener(id);
  }

  // ---------- Claude ----------
  let generando = null; // { id, version } del diseño que está escribiendo Claude ahora

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

  function generarConClaude(id, { indicaciones } = {}) {
    if (!asistente) throw new DisenoError('El chat con Claude no está disponible');
    const r = leer(id);
    asistente.nuevaSesion({ conversacion: 'diseno' });
    asistente.preguntar({ texto: promptGenerar(r, { indicaciones }), conversacion: 'diseno' });
    generando = { id: r.id, version: r.version };
    actualizar(r.id, { estado: 'generando', error: null });
    avisar(r.id);
    return obtener(r.id);
  }

  // Cuando Claude termina: si no llegó a guardar nada, se avisa
  function alEventoClaude(e) {
    if (e.conversacion !== 'diseno' || (e.tipo !== 'fin' && e.tipo !== 'error') || !generando) return;
    const { id, version } = generando;
    generando = null;
    let r;
    try { r = leer(id); } catch { return; }
    if (r.estado !== 'generando') return;
    const sinGuardar = r.version === version;
    // Si el último guardado no se pudo dibujar, ese error es el que hay que ver (p. ej. falta el navegador)
    const sinDibujar = !sinGuardar && r.error && !json(r.previas, []).length;
    actualizar(id, {
      estado: sinDibujar || (sinGuardar && !r.version) ? 'error' : 'listo',
      error: e.tipo === 'error' ? `Claude no ha podido terminar: ${e.mensaje || 'error'}` : sinGuardar ? 'Claude ha terminado sin guardar el diseño. Pídeselo en el chat.' : sinDibujar ? r.error : null,
    });
    avisar(id);
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
      const sigueGenerando = generando?.id === r.id;
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
    if (['exportando', 'renderizando', 'generando'].includes(r.estado)) throw new DisenoError('Espera a que termine lo que está haciendo');
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
    if (r.formato === 'carrusel') {
      const destino = libre(previas[0]) || libre(r.pieza_origen);
      const campos = { titulo: r.titulo, formato: 'Carrusel', estado: 'listo', caption: datos.caption || r.caption || null, archivos: guardados };
      if (destino) { sustituidos.push(...destino.archivos); ids = [jarvis.actualizarPieza(destino.id, campos).id]; }
      else ids = [jarvis.crearPieza({ ...campos, origen: 'dashboard' }).id];
    } else {
      ids = guardados.map((a, i) => {
        const campos = { titulo: `${r.titulo} · ${i + 1}/${guardados.length}`, formato: 'Story', estado: 'listo', archivos: [a] };
        const destino = previas.length === guardados.length ? libre(previas[i]) : null;
        if (destino) { sustituidos.push(...destino.archivos); return jarvis.actualizarPieza(destino.id, campos).id; }
        return jarvis.crearPieza({ ...campos, origen: 'dashboard', registrarActividad: i === 0 }).id;
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
    if (generando?.id === r.id) generando = null;
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

  return { listar, obtener, crear, generar: generarConClaude, alEventoClaude, guardarDatos, exportar, borrar, rutaPrevia, ESTADOS };
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'diseno';
