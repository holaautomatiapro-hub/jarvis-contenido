import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Base de datos local (SQLite integrado en Node: no hay nada que compilar en Windows).
// La comparten el dashboard y el MCP de Hermes/Claude Code; WAL permite varios procesos a la vez.

export const ESTADOS = ['idea', 'guion', 'grabar', 'editar', 'listo', 'publicado'];
export const CATEGORIAS = ['ideas', 'contenido', 'analisis', 'administracion', 'aprendizaje'];
export const TIPOS_ACTIVIDAD = ['Idea', 'Contenido', 'Nota', 'Tarea', 'Analisis', 'Hermes'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tareas (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  hecha INTEGER NOT NULL DEFAULT 0,
  fecha TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'contenido',
  origen TEXT NOT NULL DEFAULT 'dashboard',
  creado TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  completada TEXT
);
CREATE INDEX IF NOT EXISTS tareas_fecha ON tareas(fecha);

CREATE TABLE IF NOT EXISTS piezas (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'idea',
  formato TEXT,
  plataformas TEXT,
  fecha TEXT,
  nota TEXT,
  origen TEXT NOT NULL DEFAULT 'dashboard',
  orden REAL NOT NULL DEFAULT 0,
  creado TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS piezas_estado ON piezas(estado);

CREATE TABLE IF NOT EXISTS actividad (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  tipo TEXT NOT NULL,
  texto TEXT NOT NULL,
  origen TEXT NOT NULL DEFAULT 'dashboard'
);
CREATE INDEX IF NOT EXISTS actividad_ts ON actividad(ts);

CREATE TABLE IF NOT EXISTS enrutamiento (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ruta TEXT NOT NULL,
  modelo TEXT NOT NULL,
  etiqueta TEXT NOT NULL,
  canal TEXT NOT NULL DEFAULT 'texto',
  ok INTEGER,
  duracion_ms INTEGER,
  coste REAL
);

CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ig_media (
  id TEXT PRIMARY KEY,
  tipo TEXT,
  formato TEXT,
  caption TEXT,
  permalink TEXT,
  miniatura TEXT,
  media_url TEXT,
  fecha TEXT,
  likes INTEGER,
  comentarios INTEGER,
  alcance INTEGER,
  views INTEGER,
  guardados INTEGER,
  compartidos INTEGER,
  interacciones INTEGER,
  ver_medio_ms INTEGER,
  tema TEXT,
  gancho TEXT,
  transcrita INTEGER NOT NULL DEFAULT 0,
  nota TEXT,
  error_transcripcion TEXT,
  actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ig_media_fecha ON ig_media(fecha);

CREATE TABLE IF NOT EXISTS comp_perfiles (
  username TEXT PRIMARY KEY,
  nombre TEXT,
  bio TEXT,
  seguidores INTEGER,
  publicaciones INTEGER,
  foto TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  anadido TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ultima_sync TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS comp_media (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  formato TEXT,
  caption TEXT,
  permalink TEXT,
  miniatura TEXT,
  fecha TEXT,
  likes INTEGER,
  comentarios INTEGER,
  gancho TEXT
);
CREATE INDEX IF NOT EXISTS comp_media_user ON comp_media(username);

CREATE TABLE IF NOT EXISTS comp_analisis (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  perfiles TEXT NOT NULL,
  datos TEXT NOT NULL,
  nota TEXT
);

CREATE TABLE IF NOT EXISTS ads_biblioteca (
  id TEXT PRIMARY KEY,
  competidor TEXT,
  pagina_id TEXT,
  pagina TEXT,
  cuerpo TEXT,
  titulo TEXT,
  inicio TEXT,
  fin TEXT,
  snapshot TEXT,
  plataformas TEXT,
  alcance_ue INTEGER,
  actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ads_borradores (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  estado TEXT NOT NULL DEFAULT 'borrador',
  origen TEXT NOT NULL DEFAULT 'dashboard',
  datos TEXT NOT NULL,
  resultado TEXT
);

CREATE TABLE IF NOT EXISTS pub_versiones (
  id INTEGER PRIMARY KEY,
  pieza_id INTEGER NOT NULL,
  red TEXT NOT NULL,
  formato TEXT,
  titulo TEXT,
  texto TEXT NOT NULL,
  extra TEXT,
  notas TEXT,
  fecha TEXT,
  hora TEXT,
  estado TEXT NOT NULL DEFAULT 'listo',
  publicado TEXT,
  origen TEXT NOT NULL DEFAULT 'dashboard',
  creado TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS pub_versiones_pieza ON pub_versiones(pieza_id);
CREATE INDEX IF NOT EXISTS pub_versiones_fecha ON pub_versiones(fecha);

CREATE TABLE IF NOT EXISTS ig_serie (
  fecha TEXT NOT NULL,
  metrica TEXT NOT NULL,
  valor REAL NOT NULL,
  PRIMARY KEY (fecha, metrica)
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 4000;');
  db.exec(SCHEMA);
  // Migraciones de columnas añadidas después (se ignoran si ya existen)
  for (const sql of ['ALTER TABLE comp_perfiles ADD COLUMN fb_pagina TEXT']) {
    try { db.exec(sql); } catch { /* ya existe */ }
  }
  return db;
}

// Convierte las filas (objetos sin prototipo) en objetos normales para JSON.
export const rows = (stmt, ...args) => stmt.all(...args).map((r) => ({ ...r }));
export const row = (stmt, ...args) => {
  const r = stmt.get(...args);
  return r ? { ...r } : null;
};

// Ajustes clave-valor guardados como JSON (conexiones, estado de sincronización…)
export function ajustes(db) {
  const get = db.prepare('SELECT valor FROM ajustes WHERE clave = ?');
  const set = db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor');
  const del = db.prepare('DELETE FROM ajustes WHERE clave = ?');
  return {
    leer: (k, d = null) => { const r = get.get(k); if (!r) return d; try { return JSON.parse(r.valor); } catch { return d; } },
    guardar: (k, v) => set.run(k, JSON.stringify(v)),
    borrar: (k) => del.run(k),
  };
}
