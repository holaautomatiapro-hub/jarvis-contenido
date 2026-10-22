import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Base de datos local (SQLite integrado en Node: no hay nada que compilar en Windows).
// La comparten el dashboard y el MCP de Hermes/Claude Code; WAL permite varios procesos a la vez.

export const ESTADOS = ['idea', 'guion', 'grabar', 'editar', 'listo', 'publicado'];
export const CATEGORIAS = ['ideas', 'contenido', 'analisis', 'administracion', 'aprendizaje'];
// Objetivo de una pieza: atraer (alcance, gente nueva), nutrir (confianza) o convertir (ventas, leads)
export const OBJETIVOS = ['atraer', 'nutrir', 'convertir'];
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

-- Anunciantes que sigues en la Biblioteca de anuncios (Meta Ads → Anuncios de la competencia)
CREATE TABLE IF NOT EXISTS ads_anunciantes (
  pagina_id TEXT PRIMARY KEY,
  nombre TEXT,
  anadido TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ultima_sync TEXT,
  error TEXT
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
  const migrar = (sql) => { try { db.exec(sql); return true; } catch { return false; /* ya existe */ } };
  migrar('ALTER TABLE comp_perfiles ADD COLUMN fb_pagina TEXT');
  // Anuncios de la competencia: todo su texto, cuándo se vio activo por última vez, su vídeo/imágenes y su transcripción
  for (const sql of [
    'ALTER TABLE ads_biblioteca ADD COLUMN cuerpos TEXT',
    'ALTER TABLE ads_biblioteca ADD COLUMN descripcion TEXT',
    'ALTER TABLE ads_biblioteca ADD COLUMN visto TEXT',
    'ALTER TABLE ads_biblioteca ADD COLUMN medios TEXT',
    'ALTER TABLE ads_biblioteca ADD COLUMN transcripcion TEXT',
    'ALTER TABLE ads_biblioteca ADD COLUMN nota TEXT',
  ]) migrar(sql);
  // Competencia: vídeo y slides de cada publicación, visualizaciones (si Instagram las da) y transcripción
  for (const sql of [
    'ALTER TABLE comp_media ADD COLUMN media_url TEXT',
    'ALTER TABLE comp_media ADD COLUMN hijos TEXT',
    'ALTER TABLE comp_media ADD COLUMN vistas INTEGER',
    'ALTER TABLE comp_media ADD COLUMN transcripcion TEXT',
    'ALTER TABLE comp_media ADD COLUMN nota TEXT',
    // Publicaciones traídas por su enlace (Laboratorio → Replicar)
    'ALTER TABLE comp_media ADD COLUMN por_enlace TEXT',
    'ALTER TABLE comp_media ADD COLUMN autor_seguidores INTEGER',
  ]) migrar(sql);
  // Tareas con estado, prioridad y fecha límite (día, semana o mes)
  for (const sql of [
    'ALTER TABLE tareas ADD COLUMN descripcion TEXT',
    "ALTER TABLE tareas ADD COLUMN estado TEXT NOT NULL DEFAULT 'sin_empezar'",
    "ALTER TABLE tareas ADD COLUMN prioridad TEXT NOT NULL DEFAULT 'media'",
    'ALTER TABLE tareas ADD COLUMN plazo_desde TEXT',
    'ALTER TABLE tareas ADD COLUMN plazo_hasta TEXT',
    'ALTER TABLE tareas ADD COLUMN actualizado TEXT',
  ]) migrar(sql);
  // Solo la primera vez: las tareas de antes eran de un día concreto
  if (migrar('ALTER TABLE tareas ADD COLUMN plazo_tipo TEXT')) {
    db.exec("UPDATE tareas SET plazo_tipo = 'dia', plazo_desde = fecha, plazo_hasta = fecha, estado = CASE WHEN hecha = 1 THEN 'terminada' ELSE 'sin_empezar' END");
  }
  // Contenido: hora, caption, archivos, enlace al vídeo y carpeta de la biblioteca
  for (const sql of [
    'ALTER TABLE piezas ADD COLUMN hora TEXT',
    'ALTER TABLE piezas ADD COLUMN caption TEXT',
    "ALTER TABLE piezas ADD COLUMN archivos TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE piezas ADD COLUMN video_url TEXT',
    'ALTER TABLE piezas ADD COLUMN carpeta TEXT',
  ]) migrar(sql);
  // Publicar en Instagram: lo marca la persona en el dashboard; el resto lo rellena el publicador
  for (const sql of [
    'ALTER TABLE piezas ADD COLUMN publicar_ig INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE piezas ADD COLUMN ig_estado TEXT',
    'ALTER TABLE piezas ADD COLUMN ig_error TEXT',
    'ALTER TABLE piezas ADD COLUMN ig_contenedor TEXT',
    'ALTER TABLE piezas ADD COLUMN ig_media_id TEXT',
    'ALTER TABLE piezas ADD COLUMN ig_permalink TEXT',
    'ALTER TABLE piezas ADD COLUMN ig_publicado_en TEXT',
  ]) migrar(sql);
  // Lead magnet de cada pieza: si lleva uno y su enlace (para copiarlo al responder comentarios o DMs)
  migrar('ALTER TABLE piezas ADD COLUMN leadmagnet INTEGER NOT NULL DEFAULT 0');
  migrar('ALTER TABLE piezas ADD COLUMN leadmagnet_url TEXT');
  // Portada de un reel (JSON de un archivo de imagen): Instagram la usa como cover
  migrar('ALTER TABLE piezas ADD COLUMN portada TEXT');
  // Estrategia de cada pieza (para saber qué funciona) y de dónde sale: otra pieza (padre_id) o un trabajo
  // del Laboratorio, un diseño… (origen_ref, texto: «Testimonio · Ana», «laboratorio:clips/Ana/clip-1.mp4»)
  for (const sql of [
    'ALTER TABLE piezas ADD COLUMN pilar TEXT',
    'ALTER TABLE piezas ADD COLUMN objetivo TEXT',
    'ALTER TABLE piezas ADD COLUMN gancho TEXT',
    'ALTER TABLE piezas ADD COLUMN cta TEXT',
    'ALTER TABLE piezas ADD COLUMN padre_id INTEGER',
    'ALTER TABLE piezas ADD COLUMN origen_ref TEXT',
  ]) migrar(sql);
  // Cómo se unió la pieza con su publicación de Instagram: jarvis, enlace, caption, fecha, manual o ninguna (soltada a mano)
  migrar('ALTER TABLE piezas ADD COLUMN ig_vinculo TEXT');
  // Estrategia: cada semana del calendario de marketing (atraer, educar o vender) y, si se cambia, su propia tabla de días
  db.exec(`CREATE TABLE IF NOT EXISTS estrategia_semanas (
    lunes TEXT PRIMARY KEY,
    tipo TEXT,
    objetivo TEXT,
    detalle TEXT,
    tactica TEXT,
    campana TEXT,
    celdas TEXT,
    notas TEXT,
    actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  // La nota de 02-Guiones con el guion de la pieza (cuando su "nota" es otra: la idea de la que sale)
  migrar('ALTER TABLE piezas ADD COLUMN guion_nota TEXT');
  // El botón de la estrategia que cubre la pieza (LM, Viral, Educar, Testimonio…)
  migrar('ALTER TABLE piezas ADD COLUMN categoria TEXT');
  // La plantilla de semana que se puso en esa semana (su nombre)
  migrar('ALTER TABLE estrategia_semanas ADD COLUMN plantilla TEXT');
  // Guiones de stories (Laboratorio → Stories): de un carrusel, un reel o un tema; después se diseñan con el kit
  db.exec(`CREATE TABLE IF NOT EXISTS stories_guiones (
    id INTEGER PRIMARY KEY,
    titulo TEXT NOT NULL,
    pieza_origen INTEGER,
    tema TEXT,
    objetivo TEXT,
    cantidad INTEGER NOT NULL DEFAULT 5,
    indicaciones TEXT,
    guion TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'listo',
    error TEXT,
    diseno_id INTEGER,
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS piezas_padre ON piezas(padre_id); CREATE INDEX IF NOT EXISTS piezas_origen_ref ON piezas(origen_ref);');
  // Windsor: todas las métricas de cada publicación (JSON) e historias
  migrar('ALTER TABLE ig_media ADD COLUMN extra TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS ig_historias (
    id TEXT PRIMARY KEY,
    fecha TEXT,
    datos TEXT NOT NULL,
    actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS contenido_carpetas (
    nombre TEXT PRIMARY KEY,
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS tareas_plazo ON tareas(plazo_desde, plazo_hasta);
  -- Lo que JARVIS ha aprendido de las correcciones de la persona (sus gustos), para las próximas piezas
  CREATE TABLE IF NOT EXISTS preferencias (
    id INTEGER PRIMARY KEY,
    ambito TEXT NOT NULL DEFAULT 'diseno',
    texto TEXT NOT NULL,
    origen TEXT,
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  -- Diseños (carruseles y stories) hechos con el sistema de diseño del vault
  CREATE TABLE IF NOT EXISTS disenos (
    id INTEGER PRIMARY KEY,
    titulo TEXT NOT NULL,
    formato TEXT NOT NULL DEFAULT 'carrusel',
    plantilla TEXT,
    guion TEXT,
    nota TEXT,
    pieza_origen INTEGER,
    datos TEXT,
    caption TEXT,
    estado TEXT NOT NULL DEFAULT 'nuevo',
    version INTEGER NOT NULL DEFAULT 0,
    previas TEXT NOT NULL DEFAULT '[]',
    avisos TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    progreso INTEGER,
    exportado TEXT,
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS piezas_fecha ON piezas(fecha);`);
  // Diseños que son la portada de una pieza (no salen en la lista de Diseño)
  migrar('ALTER TABLE disenos ADD COLUMN uso TEXT');
  // Huella de cada diapositiva dibujada: solo se vuelve a dibujar (o a exportar) la que cambia
  migrar('ALTER TABLE disenos ADD COLUMN huellas TEXT');
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
