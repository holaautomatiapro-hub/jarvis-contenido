// Qué sale en el pipeline: las ideas, lo publicado, lo que tiene fecha y lo que pusiste tú (moviéndolo o eligiendo su fase).
// Lo que solo está en la biblioteca (subidas, Laboratorio, Diseño, el conector de Claude) no, hasta que le pongas fecha o la muevas.
export const enPipeline = (p) => p.estado === 'idea' || p.estado === 'publicado' || Boolean(p.fecha) || Boolean(p.en_pipeline);
