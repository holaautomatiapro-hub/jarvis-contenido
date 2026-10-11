// Datos de ejemplo para ver el dashboard antes de conectar cuentas.
// El servidor los sirve en /api/inicio mientras no haya datos reales.

export const demoInicio = {
  demo: true,
  kpis: [
    { id: 'tareas', label: 'Tareas hoy', value: 24, delta: -32, color: 'var(--orange)', icon: 'checkCircle', series: [9, 12, 10, 14, 11, 13, 17, 15, 18, 16, 20, 24] },
    { id: 'ideas', label: 'Ideas capturadas', value: 18, delta: 55, color: 'var(--blue)', icon: 'bulb', series: [4, 6, 5, 8, 7, 9, 8, 11, 10, 13, 15, 18] },
    { id: 'notas', label: 'Notas', value: 53, delta: 12, color: 'var(--purple)', icon: 'doc', series: [30, 34, 33, 38, 36, 41, 39, 44, 46, 45, 50, 53] },
    { id: 'contenido', label: 'Contenido analizado', value: 12, delta: 40, color: 'var(--green)', icon: 'chart', series: [3, 4, 4, 6, 5, 7, 6, 8, 9, 8, 10, 12] },
  ],
  foco: [
    { label: 'Ideas', pct: 32, color: 'var(--blue)', icon: 'bulb' },
    { label: 'Contenido', pct: 28, color: 'var(--purple)', icon: 'pen' },
    { label: 'Análisis', pct: 18, color: 'var(--orange)', icon: 'chart' },
    { label: 'Administración', pct: 12, color: 'var(--green)', icon: 'briefcase' },
    { label: 'Aprendizaje', pct: 10, color: 'var(--cyan)', icon: 'book' },
  ],
  sistema: [
    { label: 'Claude Code', icon: 'claude', estado: 'on' },
    { label: 'Obsidian', icon: 'obsidian', estado: 'on' },
    { label: 'Voz · ElevenLabs', icon: 'mic', estado: 'on' },
    { label: 'Instagram', icon: 'instagram', estado: 'on' },
    { label: 'Meta Ads', icon: 'ads', estado: 'on' },
    { label: 'Hermes · Telegram', icon: 'telegram', estado: 'on' },
    { label: 'JARVIS Core', icon: 'core', estado: 'on' },
  ],
  actividad: [
    { hora: '09:14', icon: 'pen', color: 'var(--purple)', texto: 'Guion generado: "3 errores que frenan tu crecimiento en Instagram"', tag: 'Contenido' },
    { hora: '08:47', icon: 'bulb', color: 'var(--blue)', texto: 'Nueva idea capturada por voz: automatizar respuestas a comentarios', tag: 'Idea' },
    { hora: '08:32', icon: 'telegram', color: 'var(--cyan)', texto: 'Hermes envió el plan del día por Telegram', tag: 'Hermes' },
    { hora: '07:58', icon: 'doc', color: 'var(--green)', texto: 'Nota sincronizada con Obsidian: transcripción del reel del lunes', tag: 'Nota' },
    { hora: '07:30', icon: 'checkCircle', color: 'var(--orange)', texto: 'Completadas 3 tareas del plan de la mañana', tag: 'Tarea' },
  ],
};

export const TAG_COLORS = {
  Contenido: ['rgba(139,92,246,.16)', 'var(--violeta-texto)'],
  Idea: ['rgba(59,130,246,.16)', 'var(--azul-texto)'],
  Nota: ['rgba(34,197,94,.14)', 'var(--verde-texto)'],
  Tarea: ['rgba(245,158,11,.15)', 'var(--ambar-texto)'],
  Hermes: ['rgba(34,211,238,.13)', 'var(--cian-texto)'],
  'Análisis': ['rgba(34,197,94,.14)', 'var(--verde-texto)'],
};
