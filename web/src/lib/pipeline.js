
// Un hueco del calendario (lo que pasa Estrategia al calendario, o una fecha reservada a mano): está en «idea», tiene día
// y aún no tiene nada dentro (ni nota, ni archivos, ni texto). Sale solo en el calendario: no es una idea.
export const esHueco = (p) => p.estado === 'idea' && Boolean(p.fecha) && !p.nota && !(p.archivos?.length) && !String(p.caption || '').trim() && !String(p.gancho || '').trim();
// Lo que sale en la pestaña Ideas
export const esIdea = (p) => p.estado === 'idea' && !esHueco(p);

// Qué sale en el pipeline: las ideas (las mismas que en la pestaña Ideas), lo publicado, lo que tiene fecha y lo que pusiste
// tú (moviéndolo o eligiendo su fase). Los huecos del calendario (día con título y nada dentro) se quedan solo en el calendario.
// Lo que solo está en la biblioteca (subidas, Laboratorio, Diseño, el conector de Claude) no, hasta que le pongas fecha o la muevas.
export const enPipeline = (p) => (p.estado === 'idea' ? esIdea(p) : p.estado === 'publicado' || Boolean(p.fecha) || Boolean(p.en_pipeline));
