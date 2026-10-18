import { ejecutar, mcpConfigDe } from './claude-runner.js';

// Orquesta las conversaciones con JARVIS: Claude Code responde en directo y cada petición queda registrada
// (modelo, duración y coste equivalente) en la tabla enrutamiento.

export class OcupadoError extends Error {}

export const MODELOS = ['haiku', 'sonnet', 'opus'];
const etiquetaDe = (m) => `Claude ${m[0].toUpperCase()}${m.slice(1)}`;
// Modelo de cada petición: el que se elige a mano, el fijo de la conversación o el suyo por defecto (Sonnet si no tiene)
export function modeloPara(conv, elegido) {
  if (MODELOS.includes(elegido)) return elegido;
  return conv.modeloFijo || conv.modeloPorDefecto || 'sonnet';
}

// Conversaciones independientes, cada una con su sesión de Claude Code
export const CONVERSACIONES = {
  principal: { modeloPorDefecto: 'sonnet', sistema: null },
  ads: {
    modeloPorDefecto: 'sonnet',
    sistema: `Estás en el ASISTENTE DE META ADS de JARVIS. Herramientas: ads_rendimiento (gasto, CTR, CPC y resultados por campaña), ads_biblioteca (anuncios de la competencia en la Ad Library), contenido_para_impulsar (publicaciones orgánicas que conviene promocionar) y proponer_campana.
Reglas que no se rompen:
- Tú NO creas campañas: proponer_campana deja un BORRADOR. La persona lo revisa y pulsa "Crear en pausa" en la pestaña Meta Ads; se crea en PAUSA y la activa ella en el Administrador de anuncios. Dilo siempre al proponer.
- Antes de proponer, confirma objetivo, presupuesto diario y duración si la persona no los dijo. Indica el gasto máximo (presupuesto × días).
- Da cifras con su moneda y no inventes datos: si algo es de ejemplo (no conectado), dilo.
- Respuestas cortas, con números concretos y una recomendación clara.`,
  },
  publicar: {
    modeloPorDefecto: 'sonnet',
    sistema: 'Estás en "Crea una vez, publica en todos lados" de JARVIS. Adaptas una pieza a cada red con versiones nativas y las guardas con guardar_versiones. NUNCA publicas nada: la persona copia cada versión y la publica ella.',
  },
  // Tareas automáticas de fondo (clasificar temas, perfil de voz…)
  sistema: { modeloPorDefecto: 'haiku', sinMemoria: true, sistema: 'Estás ejecutando una tarea automática en segundo plano: no hagas preguntas, hazla y responde en una o tres líneas.' },
  guiones: {
    modeloPorDefecto: 'sonnet',
    sistema: `Estás en el CHAT PARA GUIONES de JARVIS. Antes de escribir cualquier guion:
1. Lee _voz.md y escribe con esa voz (si está vacío, tono cercano y directo, y avísalo en una línea).
2. Busca con buscar_notas en 03-Transcripciones y 01-Ideas historias, frases e ideas relacionadas con el tema y úsalas como materia prima. No escribas desde cero si hay material propio; di de qué nota sale cada idea reutilizada.
3. Si hay una skill adecuada en .claude/skills (guion-reel-30s, guion-reel-60s, ganchos-reel, carrusel-educativo…), síguela.
4. Si el contenido es para un día concreto o para planificar varios días, mira con ver_estrategia qué toca ese día (semana para atraer, educativa o de venta) y haz que cumpla con eso.
Cuando la persona dé el guion por bueno o pida guardarlo, guárdalo con crear_nota en 02-Guiones y crea o mueve la pieza del pipeline al estado "guion".`,
  },
  replicar: {
    modeloPorDefecto: process.env.JARVIS_MODELO_REPLICAR || 'sonnet',
    sistema: `Estás en REPLICAR de JARVIS: a partir de una publicación que funcionó (de la persona o de su competencia) escribes versiones nuevas con SU voz y en los formatos que pida, y las dejas como piezas del pipeline con su guion en 02-Guiones.
- Entiende primero por qué funcionó; luego adapta, no copies (nunca frases literales de la competencia).
- Lee _voz.md y CLAUDE.md antes de escribir. Usa las fases de ver_pipeline.
- No publicas nada. Responde breve, en español.`,
  },
  // Laboratorio: clips de testimonios y edición de reels con el plugin «testimonios». Va en su propio carril:
  // un montaje largo no bloquea el resto de JARVIS. El entorno (carpeta, plugin, permisos) lo pone server/laboratorio.js.
  laboratorio: {
    modeloFijo: 'opus',
    carril: 'laboratorio',
    sistema: `Estás en el LABORATORIO de JARVIS: conviertes entrevistas de clientes en clips, stories, carruseles en vídeo, portadas y captions con el plugin «testimonios», y editas los reels de la persona.
- No tienes AskUserQuestion ni SendUserFile: pregunta en el chat (pocas preguntas, con opciones numeradas y una recomendada) y di qué archivos has generado; la persona los ve en el Laboratorio.
- Las paradas de revisión de las skills se respetan: enseña el texto y ESPERA el visto bueno en el chat antes de renderizar.
- Cifras y frases literales de la entrevista. Nunca publiques nada.
- Responde breve, en español sencillo.`,
  },
  diseno: {
    modeloFijo: 'opus',
    sistema: `Estás en DISEÑO de JARVIS: conviertes guiones en carruseles y stories con el sistema de diseño de la persona (el kit de _diseno/).
Herramientas del MCP jarvis: ver_kit_diseno (plantillas, guía, ejemplos y reglas técnicas: léelo siempre antes de diseñar), ver_diseno, guardar_diseno, listar_medios, ver_pieza.
- Para mirar un carrusel o reel que ya está en la biblioteca (aunque sus diapositivas sean vídeos), usa ver_pieza y lee con Read las imágenes que devuelve.
- Una diapositiva con alguien hablando: dale su "duracion" (hasta 60 s), el vídeo con data-from (desde qué segundo) y data-audio (se oye al exportar en MP4), y los subtítulos con subtitulos_video + subtitulos() (lo explican las reglas de ver_kit_diseno). Se exporta en MP4.
- Sigue la guía del kit al pie de la letra (colores, tipografías, tamaños, composición, animación y caption) y copia la forma de trabajar de su ejemplo.
- Cada diapositiva dibuja la idea (tarjetas, chats, gráficas, contadores), no solo texto.
- Guarda siempre con guardar_diseno y corrige los avisos que devuelva antes de terminar. Mira las vistas previas con Read cuando dudes.
- Si la persona pide cambios, usa ver_diseno, cambia solo lo pedido y vuelve a guardar con el mismo id. Las diapositivas que no toques déjalas exactamente igual (copia su html y su js tal cual): JARVIS solo vuelve a dibujar y a exportar las que cambian, y así tarda mucho menos.
- Tú no exportas ni publicas: la persona lo exporta a la biblioteca y lo programa desde la pestaña Contenido.
- Responde breve, en español.`,
  },
};

// entornos: { conversacion: () => ({ cwd, env, pluginDirs, herramientasExtra, sistema }) } para las conversaciones que
// trabajan fuera del vault (el Laboratorio). Cada conversación con "carril" propio va en paralelo a las demás.
export function createAsistente({ db, jarvis, vaultPath, emitir = () => {}, ejecutarImpl = ejecutar, entornos = {} }) {
  const q = {
    ins: db.prepare('INSERT INTO enrutamiento (ruta, modelo, etiqueta, canal) VALUES (?, ?, ?, ?)'),
    fin: db.prepare('UPDATE enrutamiento SET ok = ?, duracion_ms = ?, coste = ? WHERE id = ?'),
  };

  const sesiones = Object.fromEntries(Object.keys(CONVERSACIONES).map((k) => [k, null])); // id de sesión de Claude Code por conversación
  const actuales = {};   // petición en curso de cada carril (una a la vez por carril)
  const carrilDe = (conversacion) => CONVERSACIONES[conversacion]?.carril || 'principal';
  let historial = [];    // eventos (para quien abra la pestaña a mitad)
  let n = 0;
  let seq = 0;           // número de evento, para que el navegador no pierda ni duplique nada

  const enviar = (e) => {
    const ev = { ...e, seq: ++seq, at: Date.now() };
    historial.push(ev);
    if (historial.length > 600) historial = historial.slice(-600);
    emitir({ type: 'jarvis', ...ev });
  };

  function preguntar({ texto, canal = 'texto', modelo: forzarModelo, conversacion = 'principal' }) {
    const prompt = String(texto || '').trim();
    if (!prompt) throw new Error('Falta "texto"');
    const conv = CONVERSACIONES[conversacion];
    if (!conv) throw new Error('Falta "conversacion" válida');
    const carril = carrilDe(conversacion);
    if (actuales[carril]) throw new OcupadoError(carril === 'principal' ? 'JARVIS está terminando otra petición. Espera un momento o cancélala.' : 'El Laboratorio está terminando otro trabajo. Espera a que acabe o cancélalo.');
    const extra = entornos[conversacion]?.() || {};

    const modelo = modeloPara(conv, forzarModelo);
    const decision = { modelo, etiqueta: etiquetaDe(modelo) };
    const id = ++n;
    const { lastInsertRowid } = q.ins.run(conversacion, modelo, decision.etiqueta, canal);
    enviar({ id, conversacion, tipo: 'pregunta', texto: prompt, canal, modelo, etiqueta: decision.etiqueta });

    const t0 = Date.now();
    const run = ejecutarImpl({
      prompt: canal === 'voz' ? `${prompt}\n\n(Te hablo por voz: responde breve y natural, como si hablaras.)` : prompt,
      cwd: extra.cwd || vaultPath,
      env: extra.env,
      pluginDirs: extra.pluginDirs,
      herramientasExtra: extra.herramientasExtra,
      modelo: decision.modelo,
      sesion: conv.sinMemoria ? null : sesiones[conversacion],
      sistema: [conv.sistema, extra.sistema].filter(Boolean).join('\n\n') || null,
      mcpConfig: mcpConfigDe(vaultPath),
      onEvento: (e) => {
        if (e.tipo === 'inicio' && e.sesion) sesiones[conversacion] = e.sesion;
        if (e.tipo === 'fin' || e.tipo === 'error') {
          if (e.sesion) sesiones[conversacion] = e.sesion;
          q.fin.run(e.tipo === 'fin' ? 1 : 0, e.duracion ?? Date.now() - t0, e.coste ?? null, lastInsertRowid);
          if (actuales[carril]?.id === id) delete actuales[carril];
        }
        enviar({ id, conversacion, ...e });
      },
    });
    actuales[carril] = { id, run, decision, conversacion, desde: Date.now(), texto: prompt.slice(0, 300) };
    run.terminado.then(() => { if (actuales[carril]?.id === id) delete actuales[carril]; });
    return { id, ...decision };
  }

  function cancelar({ conversacion = 'principal' } = {}) {
    const a = actuales[carrilDe(conversacion)];
    if (!a) return { ok: false };
    a.run.cancelar();
    return { ok: true };
  }

  function nuevaSesion({ conversacion = 'principal' } = {}) {
    if (!(conversacion in sesiones)) throw new Error('Falta "conversacion" válida');
    const a = actuales[carrilDe(conversacion)];
    if (a?.conversacion === conversacion) a.run.cancelar();
    sesiones[conversacion] = null;
    historial = historial.filter((e) => e.conversacion !== conversacion);
    enviar({ id: 0, conversacion, tipo: 'sesion_nueva' });
    return { ok: true };
  }

  // La conversación que está trabajando ahora en un carril (p. ej. «replicar»), o null
  const conversacionActiva = (carril = 'principal') => actuales[carril]?.conversacion || null;
  // Todo lo que está haciendo Claude ahora (un trabajo por carril)
  const enMarcha = () => Object.values(actuales).map(({ id, conversacion, desde, texto, decision }) => ({ id, conversacion, desde, texto, modelo: decision.etiqueta }));

  function estado({ conversacion = 'principal' } = {}) {
    return {
      ocupado: Boolean(actuales[carrilDe(conversacion)]),
      ocupadoAqui: actuales[carrilDe(conversacion)]?.conversacion === conversacion,
      sesion: sesiones[conversacion] ?? null,
      eventos: historial.filter((e) => e.conversacion === conversacion),
    };
  }

  // Un texto suelto (p. ej. un caption): sin conversación ni memoria, en paralelo a lo demás. Devuelve solo el texto.
  function redactar({ prompt, sistema = null, modelo = 'sonnet', limiteMs = 180_000 }) {
    const texto = String(prompt || '').trim();
    if (!texto) throw new Error('Falta "texto"');
    const { lastInsertRowid } = q.ins.run('redactar', modelo, etiquetaDe(modelo), 'texto');
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      let hecho = false;
      const acabar = (ok, valor) => {
        if (hecho) return;
        hecho = true;
        clearTimeout(reloj);
        q.fin.run(ok ? 1 : 0, Date.now() - t0, null, lastInsertRowid);
        if (ok) resolve(valor); else reject(Object.assign(new Error(valor), { publico: true }));
      };
      const run = ejecutarImpl({
        prompt: texto, cwd: vaultPath, modelo, sistema, mcpConfig: mcpConfigDe(vaultPath),
        onEvento: (e) => {
          if (e.tipo === 'fin') acabar(true, String(e.texto || '').trim());
          if (e.tipo === 'error') acabar(false, e.mensaje || 'JARVIS no ha podido escribirlo');
        },
      });
      const reloj = setTimeout(() => { run.cancelar?.(); acabar(false, 'JARVIS está tardando demasiado. Vuelve a probar.'); }, limiteMs);
      run.terminado?.then(() => acabar(false, 'JARVIS no ha devuelto nada'));
    });
  }

  return { preguntar, cancelar, nuevaSesion, estado, conversacionActiva, enMarcha, redactar };
}
