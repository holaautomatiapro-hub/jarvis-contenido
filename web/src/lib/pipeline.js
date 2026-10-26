// Qué sale en el pipeline: las ideas, lo publicado, lo que tiene fecha y lo que pusiste tú (moviéndolo o eligiendo su fase).
// Lo que solo está en la biblioteca (subidas, Laboratorio, Diseño, el conector de Claude) no, hasta que le pongas fecha o la muevas.
export const enPipeline = (p) => p.estado === 'idea' || p.estado === 'publicado' || Boolean(p.fecha) || Boolean(p.en_pipeline);

// Un hueco del calendario (lo que pasa Estrategia al calendario, o una fecha reservada a mano): está en «idea», tiene día
// y aún no tiene nada dentro (ni nota, ni archivos, ni texto). Sale en el calendario y en el pipeline, pero no es una idea.
export const esHueco = (p) => p.estado === 'idea' && Boolean(p.fecha) && !p.nota && !(p.archivos?.length) && !String(p.caption || '').trim() && !String(p.gancho || '').trim();
// Lo que sale en la pestaña Ideas
export const esIdea = (p) => p.estado === 'idea' && !esHueco(p);
