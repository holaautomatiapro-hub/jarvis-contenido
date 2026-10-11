// Sistema de diseño (kit): vive en el vault, en _diseno/, porque es de cada creador (su marca, sus
// colores, sus fotos) y no del código de JARVIS. Sin kit propio se usa el de ejemplo de diseno/kit-ejemplo.
//
// _diseno/kit.json describe qué sabe diseñar JARVIS con ese kit:
//   { "nombre", "handle", "verificado", "duracion": 7, "fps": 30, "guia": "CLAUDE.md",
//     "css": ["estilos.css"], "fuentes": ["https://fonts.googleapis.com/css2?..."], "zonaSeguraStory": [250, 300],
//     "plantillas": [{ "id", "nombre", "descripcion", "formatos": ["carrusel", "story"],
//                      "cabecera": true, "paginacion": true, "ejemplo": "ejemplos/x.json" }] }
import path from 'node:path';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { ROOT } from '../config.js';
import { leerZip } from './zip.js';

export const CARPETA_KIT = '_diseno';
// Errores que se enseñan tal cual a la persona (el servidor responde 400 con el mensaje)
export class KitError extends Error {
  constructor(m) { super(m); this.publico = true; }
}
export const FORMATOS = {
  carrusel: { nombre: 'Carrusel', ancho: 1080, alto: 1350 },
  story: { nombre: 'Stories', ancho: 1080, alto: 1920 },
};
const FUENTES_PERMITIDAS = /^https:\/\/fonts\.googleapis\.com\//;

export function createKit({ vaultPath, ejemploDir = path.join(ROOT, 'diseno', 'kit-ejemplo'), copiasDir }) {
  const propioDir = path.join(vaultPath, CARPETA_KIT);

  function leer() {
    const propio = existsSync(path.join(propioDir, 'kit.json'));
    const dir = propio ? propioDir : ejemploDir;
    let datos;
    try { datos = JSON.parse(readFileSync(path.join(dir, 'kit.json'), 'utf8')); } catch (e) {
      throw new KitError(`El kit.json de tu sistema de diseño no se puede leer (${e.message}). Revisa ${propio ? `${CARPETA_KIT}/kit.json en tu vault` : 'la instalación'}.`);
    }
    return normalizar(datos, { dir, propio });
  }

  // Ruta segura a un archivo del kit (nunca fuera de su carpeta)
  function archivo(kit, rel) {
    const abs = path.resolve(kit.dir, decodeURIComponent(String(rel)).replace(/^\/+/, ''));
    if (abs !== kit.dir && !abs.startsWith(kit.dir + path.sep)) return null;
    return existsSync(abs) ? abs : null;
  }

  function estado() {
    try {
      const k = leer();
      return { propio: k.propio, nombre: k.nombre, handle: k.handle, carpeta: k.propio ? CARPETA_KIT : null,
        plantillas: k.plantillas.map(({ id, nombre, descripcion, formatos }) => ({ id, nombre, descripcion, formatos })) };
    } catch (e) {
      return { propio: true, error: e.message, plantillas: [] };
    }
  }

  // Importa un .zip con el sistema de diseño. Si todo el contenido va dentro de una carpeta, se usa esa carpeta.
  function importar(buf) {
    let leidas;
    try { leidas = leerZip(buf); } catch (e) { throw new KitError(e.message); }
    const entradas = leidas.filter((a) => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(a.nombre));
    if (!entradas.length) throw new KitError('El .zip está vacío');
    const primeras = new Set(entradas.map((a) => a.nombre.split('/')[0]));
    const quitar = primeras.size === 1 && entradas.every((a) => a.nombre.includes('/')) ? [...primeras][0] + '/' : '';
    const archivos = entradas.map((a) => ({ ...a, nombre: a.nombre.slice(quitar.length) }));
    const json = archivos.find((a) => a.nombre === 'kit.json');
    if (!json) throw new KitError('Al .zip le falta kit.json en la carpeta principal: es el archivo que le dice a JARVIS qué plantillas tienes. Usa el kit preparado para JARVIS.');
    let datos;
    try { datos = JSON.parse(json.contenido.toString('utf8')); } catch (e) { throw new KitError(`El kit.json del .zip no es válido: ${e.message}`); }
    const tmp = path.join(vaultPath, `${CARPETA_KIT}.importando`);
    normalizar(datos, { dir: tmp, propio: true });

    rmSync(tmp, { recursive: true, force: true });
    for (const a of archivos) {
      const destino = path.resolve(tmp, a.nombre);
      if (!destino.startsWith(tmp + path.sep)) throw new KitError(`Ruta no permitida en el .zip: ${a.nombre}`);
      mkdirSync(path.dirname(destino), { recursive: true });
      writeFileSync(destino, a.contenido);
    }
    // El kit anterior se guarda fuera del vault, por si hay que volver atrás
    if (existsSync(propioDir)) {
      const copia = path.join(copiasDir || path.join(vaultPath, '.jarvis-kits'), new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
      mkdirSync(path.dirname(copia), { recursive: true });
      try { renameSync(propioDir, copia); } catch { cpSync(propioDir, copia, { recursive: true }); rmSync(propioDir, { recursive: true, force: true }); }
    }
    renameSync(tmp, propioDir);
    return estado();
  }

  return { leer, archivo, estado, importar, dirPropio: propioDir };
}

function normalizar(d, { dir, propio }) {
  if (!d || typeof d !== 'object') throw new KitError('kit.json debe ser un objeto');
  const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String);
  const plantillas = (Array.isArray(d.plantillas) ? d.plantillas : []).map((p, i) => {
    const id = String(p?.id || '').trim();
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new KitError(`La plantilla ${i + 1} de kit.json necesita un "id" en minúsculas, sin espacios (p. ej. "rejilla")`);
    const formatos = lista(p.formatos).filter((f) => FORMATOS[f]);
    return {
      id, nombre: String(p.nombre || id), descripcion: String(p.descripcion || ''),
      formatos: formatos.length ? formatos : ['carrusel'],
      cabecera: p.cabecera !== false, paginacion: p.paginacion !== false,
      ejemplo: p.ejemplo ? String(p.ejemplo) : null,
    };
  });
  if (!plantillas.length) throw new KitError('kit.json no tiene ninguna plantilla en "plantillas"');
  const num = (v, def, min, max) => (Number.isFinite(+v) && +v >= min && +v <= max ? +v : def);
  return {
    dir: path.resolve(dir), propio,
    nombre: String(d.nombre || 'Sistema de diseño'),
    handle: String(d.handle || ''),
    verificado: d.verificado === true,
    duracion: num(d.duracion, 7, 2, 30),
    fps: num(d.fps, 30, 12, 60),
    guia: d.guia ? String(d.guia) : null,
    css: lista(d.css),
    fuentes: lista(d.fuentes).filter((u) => FUENTES_PERMITIDAS.test(u)),
    // Franjas de arriba y de abajo que tapa la interfaz de Instagram en las stories (px)
    zonaStory: Array.isArray(d.zonaSeguraStory) && d.zonaSeguraStory.length === 2 ? d.zonaSeguraStory.map((v) => num(v, 250, 0, 600)) : [250, 300],
    plantillas,
  };
}
