// Catálogo de skills de contenido de JARVIS. `npm run skills` genera un SKILL.md por skill
// (formato agentskills.io, compatible con Claude Code y Hermes) en vault-template/.claude/skills/.
//
// Pocas y buenas: cada una cubre un trabajo real que no hace ya un botón del dashboard.
// Cada skill: n = nombre (carpeta), t = título, c = categoría, d = cuándo usarla,
// p = pasos, s = formato de la respuesta.

export const SKILLS = [
  // ───────────── FLUJOS COMPLETOS (un solo chat para todo) ─────────────
  { n: 'flujo-carrusel-stories', t: 'Carrusel o stories de principio a fin', c: 'flujos', sinNota: true,
    d: 'Del tema al carrusel o las stories diseñados, en la biblioteca y con día. Úsala cuando pidan "hazme un carrusel", "unas stories sobre…" o "diséñame esto".',
    p: ['Busca la pieza en listar_pipeline o créala con crear_pieza (formato Carrusel o Story) con su pilar, objetivo, gancho y CTA. Mira que_me_funciona para elegir el ángulo y el pilar que mejor te va.', 'Escribe el texto slide a slide (como carrusel-educativo o historias-secuencia-venta), guárdalo en su nota y enséñaselo. ESPERA el visto bueno antes de diseñar.', 'Diseña: ver_kit_diseno, lee con leer_archivo_kit la guía y el ejemplo de la plantilla, crear_diseno con pieza_id y guardar_diseno con las diapositivas y el caption. Corrige los avisos y mira las vistas previas con Read.', 'Con su sí: exportar_diseno (jpg, o mp4 si lo quiere en vídeo). Queda en la biblioteca, unido a la pieza.', 'Ponle día con mover_pieza (mi_semana te dice qué hueco tapar) y ofrece adaptarlo a otras redes (adaptar-a-todas-las-redes).'],
    s: 'En cada parada, lo que tiene que revisar. Al final: la pieza, el día en que sale y lo que falte, si falta algo.' },
  { n: 'flujo-replicar', t: 'Replicar un post o un reel desde su enlace', c: 'flujos', sinNota: true,
    d: 'De un enlace de Instagram de otra cuenta (carrusel, post o reel) a tu versión: el carrusel con tu diseño o el guion del reel con tu voz, como pieza lista. Úsala cuando peguen un enlace de Instagram o digan "replica este post", "hazme uno como este" o "transcribe este reel y adáptalo".',
    p: ['traer_publicacion con el enlace (si te pide la cuenta, pregunta de quién es). Te da el caption, la transcripción si es un reel y las imágenes de los slides: léelas con Read, en orden.', 'Resume en 3 líneas su estructura (gancho, desarrollo, CTA) y por qué funciona. Pregunta solo lo que falte: en qué formato lo quiere (el mismo, si no dice otro) y qué quiere cambiar.', 'Escribe su versión con su voz (_voz.md) y su negocio (CLAUDE.md): misma estructura y la misma idea en cada slide o bloque, todo el texto nuevo, nunca frases literales, y «Inspirado en: <enlace>» al final. Guárdalo en 02-Guiones con crear_nota y crea la pieza con crear_pieza (su nota, caption, pilar, objetivo, gancho y CTA). Enséñaselo y ESPERA el visto bueno.', 'Carrusel o stories: diséñalo como en flujo-carrusel-stories (ver_kit_diseno, crear_diseno con pieza_id, guardar_diseno y, con su sí, exportar_diseno). Reel: deja la pieza en la fase de grabar y, cuando lo grabe, sigue con flujo-reel.', 'Ponle día con mover_pieza tapando un hueco de mi_semana.'],
    s: 'En cada parada, lo que tiene que revisar. Al final: la pieza, el día en que sale y lo que falta (grabar, revisar el diseño…).' },
  { n: 'flujo-testimonio', t: 'Testimonio de principio a fin', c: 'flujos', sinNota: true,
    d: 'De la entrevista de un cliente a stories, carrusel, clips, portada y captions en la biblioteca, repartidos en el calendario. Úsala cuando digan "tengo la entrevista de…" o "monta el testimonio de…".',
    p: ['laboratorio_estado: comprueba que el Laboratorio está listo (plugin, Python y marca) y si la entrevista ya está subida. Si no, pide la ruta del vídeo en su ordenador y súbelo con laboratorio_subir (tipo entrevista; la foto del cliente con tipo foto y su nombre).', 'Pide solo lo que falte: nombre del cliente, qué hicisteis con él y, si quiere, la frase de la portada. Nunca inventes resultados ni frases.', 'laboratorio_encargar tipo testimonio. Lo monta el Laboratorio: ve leyendo con laboratorio_chat y enséñale el guion y los clips cuando los proponga; su respuesta, tal cual, con laboratorio_responder. Nunca des tú el visto bueno.', 'Cuando termine: laboratorio_estado para ver lo que ha salido y laboratorio_a_biblioteca (stories y clips en reel de uno en uno, el carrusel en vídeo junto, las portadas) con pilar de casos o testimonios y objetivo convertir.', 'Reparte las piezas en los huecos de mi_semana con mover_pieza (no todo el mismo día) y dile qué sale cada día.'],
    s: 'En cada parada, lo que tiene que revisar. Al final: qué piezas hay en la biblioteca y qué día sale cada una.' },
  { n: 'flujo-reel', t: 'Editar un reel de principio a fin', c: 'flujos', sinNota: true,
    d: 'De un vídeo hablando a cámara a un reel editado (sin silencios ni muletillas, con subtítulos y título) en la biblioteca y con día. Úsala cuando digan "edítame este vídeo" o "límpiame este reel".',
    p: ['laboratorio_estado y, si el vídeo no está subido, laboratorio_subir (tipo video) con la ruta que te dé.', 'Pregunta lo mínimo: si lo quiere entero o en clips, la plantilla (pantalla, ventana o feed) y si tiene título. Crea o busca su pieza con su pilar, objetivo, gancho y CTA.', 'laboratorio_encargar tipo reel (modo entero o clips). Lee con laboratorio_chat los clips y títulos que proponga, enséñaselos y pasa su respuesta con laboratorio_responder.', 'Cuando termine: laboratorio_a_biblioteca con su pilar y objetivo (el caption sale solo de _caption.md).', 'Ponle día con mover_pieza tapando un hueco de mi_semana.'],
    s: 'En cada parada, lo que tiene que revisar. Al final: la pieza y el día en que sale.' },
  { n: 'flujo-clips', t: 'De un vídeo largo a varios clips', c: 'flujos', sinNota: true,
    d: 'Saca varios clips de un directo, un pódcast o un vídeo largo, cada uno como su pieza, unidos al vídeo de origen y repartidos en el calendario. Úsala cuando digan "saca clips de…" o "trocea este vídeo". (Si es la entrevista de un cliente, usa flujo-testimonio.)',
    p: ['Crea la pieza madre del vídeo largo con crear_pieza (formato Reel, estado editar, su pilar).', 'laboratorio_estado y, si hace falta, laboratorio_subir (tipo video).', 'laboratorio_encargar tipo reel en modo clips (entre 3 y 8 clips de 30-60 s, plantilla pantalla salvo que pida otra). Lee con laboratorio_chat los clips propuestos (inicio, fin, gancho), enséñaselos y pasa su respuesta con laboratorio_responder.', 'Cuando termine: laboratorio_a_biblioteca de cada clip, de uno en uno, con padre_id de la pieza madre, su pilar y su objetivo.', 'Reparte los clips en los huecos de mi_semana (uno por día de publicación) con mover_pieza.'],
    s: 'En cada parada, lo que tiene que revisar. Al final: la lista de clips con el día en que sale cada uno.' },
  { n: 'flujo-lead-magnet', t: 'Lead magnet de principio a fin', c: 'flujos', sinNota: true,
    d: 'Del recurso gratuito a la página publicada y unida a la pieza que lo anuncia, con su CTA. Úsala cuando digan "hazme un lead magnet", "una guía para regalar" o "un checklist para captar".',
    p: ['Decide con la persona: título, tipo (guia, checklist, test, generador, recursos o calculadora), de qué va y la palabra clave para pedirlo. Busca o crea la pieza que lo va a anunciar.', 'laboratorio_encargar tipo leadmagnet con titulo, tipo, palabra, pieza y contenido. Lee con laboratorio_chat lo que vaya enseñando y pasa sus cambios con laboratorio_responder.', 'Cuando esté: asignar_leadmagnet a la pieza. Publicarlo en internet lo hace la persona en Laboratorio → Lead magnets (botón Publicar): díselo; al publicarlo, el enlace va solo a la pieza.', 'Escribe el CTA y el mensaje de respuesta con la palabra clave (como cta-lead-magnet) y guárdalo en la pieza con mover_pieza (cta y caption).'],
    s: 'En cada parada, lo que tiene que revisar. Al final: el lead magnet, la pieza que lo anuncia, el CTA y si falta publicarlo.' },

  // ───────────── GANCHOS ─────────────
  { n: 'ganchos-reel', t: 'Ganchos para reels', c: 'ganchos',
    d: 'Genera 10 ganchos para la apertura de un reel o short. Úsala cuando pidan ganchos, hooks o "cómo empiezo este vídeo".',
    p: ['Mira con metricas_instagram qué ganchos te han funcionado mejor y busca en 03-Transcripciones cómo abres tú los vídeos.', 'Escribe 10 ganchos mezclando 5 tipos: curiosidad, contradicción, lista con número, historia en marcha y pregunta al dolor.', 'Máximo 12 palabras por gancho; nada de "¿Sabías que…?" ni "En este vídeo…".', 'Elige los 3 mejores y explica en una línea por qué paran el scroll.'],
    s: 'Tabla con columnas Tipo | Gancho | Por qué funciona, y debajo el top 3 con el texto en pantalla sugerido.' },
  { n: 'evaluar-gancho', t: 'Evaluar y mejorar ganchos', c: 'ganchos',
    d: 'Puntúa uno o varios ganchos y propone versiones mejores. Úsala cuando pregunten "¿este gancho es bueno?".',
    p: ['Puntúa de 1 a 5: claridad, curiosidad, especificidad y relevancia para el público.', 'Explica el punto más débil en una frase.', 'Propón 3 versiones mejoradas que arreglen ese punto.'],
    s: 'Tabla de puntuaciones y las 3 versiones mejoradas.' },

  // ───────────── GUIONES ─────────────
  { n: 'guion-reel-30s', t: 'Guion de reel de 30 segundos', c: 'guiones',
    d: 'Guion completo de reel corto (20-35 s). Úsala cuando pidan "un guion para un reel" sin más detalle.',
    p: ['Estructura: gancho (0-3 s), problema (3-8 s), giro (8-12 s), solución en 2-3 puntos, cierre con CTA.', 'Escribe frases de máximo 15 palabras, como se dicen en voz alta.', 'Añade texto en pantalla y B-roll sugerido por bloque.'],
    s: 'Tabla Tiempo | Lo que dices | Texto en pantalla | Imagen/B-roll, y al final el caption corto.' },
  { n: 'guion-reel-60s', t: 'Guion de reel de 60 segundos', c: 'guiones',
    d: 'Guion de reel largo (45-90 s) con más desarrollo. Úsala para explicaciones o tutoriales en un solo vídeo.',
    p: ['Gancho + promesa en los primeros 5 s.', 'Desarrollo en 3 bloques con un mini-gancho de retención antes de cada uno ("pero lo importante es…").', 'Cierre con resumen en una frase y CTA.'],
    s: 'Guion por bloques con tiempos, texto en pantalla y notas de edición.' },
  { n: 'guion-caso-cliente', t: 'Guion de caso de éxito', c: 'guiones',
    d: 'Cuenta el resultado de un cliente sin sonar a anuncio. Úsala para prueba social o antes de grabar un testimonio.',
    p: ['Pide o busca: situación inicial, problema, qué hicisteis y resultado medible.', 'Empieza por el resultado o por la frase del cliente.', 'Explica el "cómo" con suficiente detalle para que sea útil aunque no compren.'],
    s: 'Guion con Antes / Proceso / Después y el CTA suave.' },
  { n: 'guion-desde-transcripcion', t: 'Nuevo guion desde un vídeo antiguo', c: 'guiones',
    d: 'Reaprovecha un vídeo antiguo con un ángulo nuevo. Úsala para reciclar contenido o cuando falten ideas.',
    p: ['Lee la transcripción indicada o, si no te dicen cuál, elige una de las que mejor funcionaron según metricas_instagram.', 'Detecta la idea principal y propone 3 ángulos nuevos (otro público, otro formato, otra emoción).', 'Escribe el guion completo del ángulo más prometedor.'],
    s: '3 ángulos en una línea cada uno y el guion completo del elegido.' },

  // ───────────── CARRUSELES ─────────────
  { n: 'carrusel-educativo', t: 'Carrusel educativo', c: 'carruseles',
    d: 'Texto de un carrusel de 7-10 slides que enseña algo concreto. Úsala cuando pidan un carrusel sin más detalle (el diseño se hace después en Laboratorio → Diseño).',
    p: ['Slide 1: titular con promesa clara (máx. 8 palabras) y subtítulo.', 'Slide 2: por qué importa o el error común.', 'Slides 3-8: un punto por slide, título + 2 líneas.', 'Penúltima: resumen. Última: CTA (guardar, comentar palabra, seguir).'],
    s: 'Slide por slide: Título / Texto / Idea visual, y el caption al final.' },
  { n: 'carrusel-desde-reel', t: 'Carrusel a partir de un reel', c: 'carruseles',
    d: 'Convierte un reel o guion en carrusel. Úsala para reaprovechar contenido.',
    p: ['Lee el guion o transcripción y extrae la idea central y los puntos.', 'Reescribe para lectura (más denso que lo hablado, sin muletillas).', 'Ajusta a 7-10 slides con titular fuerte.'],
    s: 'Slide por slide y caption.' },

  // ───────────── HISTORIAS ─────────────
  { n: 'historias-secuencia-venta', t: 'Secuencia de historias de venta', c: 'historias',
    d: 'Secuencia de 5-7 historias que lleva a escribir por DM. Úsala para vender sin anuncios.',
    p: ['Historia 1: situación o pregunta que engancha.', 'Historias 2-4: problema, coste de no resolverlo y prueba (caso, captura, testimonio).', 'Historia 5-6: la solución y para quién es.', 'Última: CTA a DM con palabra clave o sticker de enlace.'],
    s: 'Historia por historia: Texto / Visual / Sticker.' },
  { n: 'historias-testimonio', t: 'Historias con testimonios', c: 'historias',
    d: 'Convierte testimonios y capturas en historias. Úsala para prueba social (los clips en vídeo se sacan en Laboratorio → Testimonios).',
    p: ['Pide o busca los testimonios disponibles.', 'Para cada uno: captura + texto que destaca el resultado + contexto breve.', 'Cierra con "¿quieres lo mismo?" y CTA.'],
    s: 'Secuencia de historias con texto superpuesto.' },

  // ───────────── FORMATOS ─────────────
  { n: 'adaptar-a-todas-las-redes', t: 'Crea una vez, publica en todos lados', c: 'formatos', sinNota: true,
    d: 'Convierte una pieza en versiones para cada red. Úsala cuando digan "adáptalo a todas mis redes" o "distribúyelo".',
    p: ['Detecta la idea central y el formato original (lee la pieza con listar_pipeline y su nota si la tiene).', 'Crea una versión nativa por cada red que te pidan (si no lo dicen: TikTok/Shorts, LinkedIn, X y Threads).', 'Ajusta tono, longitud y CTA a cada red; no copies y pegues.', 'Guárdalas con guardar_versiones en la pieza (aparecen en su ficha, en la pestaña Contenido). No crees notas aparte.'],
    s: 'Una sección por red con el texto listo para copiar.' },
  { n: 'trocear-video-largo', t: 'De vídeo largo a clips', c: 'formatos',
    d: 'Encuentra clips cortos dentro de un vídeo o directo largo. Úsala con transcripciones largas (para cortarlos de verdad, Laboratorio → Reels).',
    p: ['Lee la transcripción y localiza 5-10 momentos con idea completa y autónoma.', 'Para cada clip: minuto de inicio y fin, gancho propuesto y título.', 'Ordénalos por potencial.'],
    s: 'Tabla Clip | Inicio-Fin | Gancho | Título.' },

  // ───────────── IDEAS ─────────────
  { n: 'pilares-de-contenido', t: 'Pilares de contenido', c: 'ideas',
    d: 'Define 3-5 pilares de contenido para la cuenta. Úsala al empezar o reorganizar la estrategia.',
    p: ['Pregunta o deduce: qué vendes, a quién y qué te diferencia (lee CLAUDE.md y _voz.md).', 'Mira con metricas_instagram qué temas ya te funcionan.', 'Propón 3-5 pilares con su objetivo y porcentaje del calendario.', '5 ideas de ejemplo por pilar. Usa siempre el mismo nombre corto de pilar al crear piezas (campo pilar de crear_pieza; ver_pilares enseña los que ya existen) para poder medir cuál funciona.'],
    s: 'Pilares con objetivo, % e ideas.' },
  { n: 'ideas-semana', t: 'Ideas para la semana', c: 'ideas',
    d: 'Plan de contenido de la semana equilibrando atraer, nutrir y convertir. Úsala cuando pidan "¿qué publico esta semana?".',
    p: ['Revisa el pipeline (listar_pipeline) y el calendario (calendario_publicaciones) antes de inventar nada: primero lo que ya está en marcha y los huecos.', 'Propón 5-7 piezas: 50 % atraer, 30 % nutrir, 20 % convertir, repartidas entre tus pilares.', 'Para cada una: formato, gancho y día sugerido.', 'Guarda las elegidas con capturar_idea.'],
    s: 'Tabla Día | Objetivo | Pilar | Formato | Idea | Gancho.' },
  { n: 'reciclar-top', t: 'Reciclar tu mejor contenido', c: 'ideas',
    d: 'Nuevas versiones de tus piezas que mejor funcionaron. Úsala cuando falten ideas.',
    p: ['Saca tus piezas top con metricas_instagram (guardados, compartidos y alcance frente a tu media).', 'Para cada una: mismo tema con otro formato, otro gancho y otra profundidad.', 'Marca cuándo republicar (mínimo 3 meses después).'],
    s: 'Pieza original → 3 versiones nuevas.' },

  // ───────────── REESCRITURA ─────────────
  { n: 'humanizar-texto', t: 'Humanizar y reescribir con mi voz', c: 'reescritura',
    d: 'Quita el tono de IA de un texto y lo deja como lo dirías tú. Úsala cuando digan que algo "suena a ChatGPT" o con textos ajenos.',
    p: ['Lee _voz.md y 2-3 transcripciones para captar expresiones reales.', 'Elimina fórmulas de IA: "en el mundo de hoy", "descubre", "sumérgete", "no solo… sino también", triadas de adjetivos, emojis de relleno.', 'Cambia frases abstractas por ejemplos concretos y ajusta el ritmo: frases cortas y medias, como se habla.'],
    s: 'Texto reescrito y lista breve de cambios.' },
  { n: 'perfil-de-voz', t: 'Perfil de voz', c: 'reescritura',
    d: 'Crea o actualiza el perfil de voz (_voz.md) a partir de las transcripciones de tus reels. Úsala cuando haya transcripciones nuevas o pidan "aprende cómo hablo".',
    p: ['Lee todas las notas de 03-Transcripciones (si no hay, avisa de que hace falta conectar Instagram o pegar textos).', 'Extrae: tono, longitud media de frase, muletillas, expresiones repetidas, palabras que nunca usa, cómo abre y cómo cierra, a quién se dirige.', 'Incluye 5-10 frases literales representativas como ejemplos.', 'Escribe el resultado en _voz.md (Write) manteniendo sus apartados (las líneas "- Tono:", "- Frases y muletillas que uso:"…) y conservando lo que la persona haya escrito a mano.'],
    s: '_voz.md actualizado y un resumen de 3 líneas de lo aprendido.' },

  // ───────────── CTA ─────────────
  { n: 'cta-lead-magnet', t: 'CTA para lead magnet', c: 'cta',
    d: 'CTA para conseguir descargas de un recurso gratuito, con palabra clave por comentario o DM. Úsala para captar leads.',
    p: ['Resume el recurso en un beneficio concreto.', 'Elige una palabra clave corta, fácil de escribir y relacionada con el regalo (si se pide por comentario o DM).', 'Escribe el CTA hablado, el texto en pantalla y la línea del caption.', 'Escribe el DM de respuesta con el enlace (si la pieza tiene lead magnet, su enlace está en la pieza: listar_pipeline).'],
    s: 'Palabra clave, CTA en 3 formatos y DM de respuesta.' },

  // ───────────── MÉTRICAS ─────────────
  { n: 'analizar-reel', t: 'Analizar un reel', c: 'metricas',
    d: 'Diagnóstico de un reel concreto: gancho, retención, CTA y métricas. Úsala cuando pregunten por qué un reel funcionó o no.',
    p: ['Saca sus métricas y la media de la cuenta con metricas_instagram, y su transcripción de 03-Transcripciones si existe.', 'Compara con la media de la cuenta.', 'Diagnostica gancho, ritmo, valor y CTA con evidencias.', 'Da 3 acciones concretas para el próximo.'],
    s: 'Resumen de métricas, diagnóstico por apartado y 3 acciones.' },
  { n: 'informe-semanal', t: 'Informe semanal', c: 'metricas',
    d: 'Informe de rendimiento de la semana. Úsala cada lunes o cuando pidan el resumen semanal.',
    p: ['Saca las publicaciones de la semana y sus métricas con metricas_instagram (periodo de 7 días).', 'Top 3 y peor pieza con hipótesis de por qué (gancho, tema, formato).', 'Avance del pipeline y lo que estaba previsto y no salió (listar_pipeline, calendario_publicaciones, resumen_del_dia).', 'Prioridades para la semana siguiente.'],
    s: 'Informe con secciones: Números, Lo mejor, Lo peor, Aprendizajes, Próxima semana. Guárdalo en 07-Diario.' },

  // ───────────── COMPETENCIA ─────────────
  { n: 'ideas-desde-competencia', t: 'Ideas adaptadas desde la competencia', c: 'competencia',
    d: 'Convierte lo que funciona a otros en ideas adaptadas a tu negocio. Úsala para buscar ideas en la competencia.',
    p: ['Saca sus mejores publicaciones con competencia_mejores (y competencia_datos para el contexto). Si los datos son de ejemplo, dilo y para.', 'Detecta los patrones que se repiten (tema, gancho, formato) y, para cada uno, adapta tema, ejemplo y CTA a tu negocio.', 'Guarda las mejores con capturar_idea.'],
    s: 'Patrón → idea adaptada → gancho.' },

  // ───────────── META ADS ─────────────
  { n: 'copy-anuncio-meta', t: 'Ángulos y copy de anuncio de Meta', c: 'ads',
    d: 'Ángulos de venta y textos de un anuncio (texto principal, título y descripción). Úsala para campañas de Meta.',
    p: ['Define oferta, público y objeciones principales; mira con ads_biblioteca qué ángulos repite la competencia.', 'Propón 5 ángulos (dolor, deseo, identidad, prueba, urgencia…) y elige los 2 mejores.', 'Para cada uno: texto principal en 3 longitudes, 5 títulos de máximo 40 caracteres, descripción y CTA del botón.', 'Si se crea una campaña, es SIEMPRE en pausa (proponer_campana deja un borrador; la persona la activa).'],
    s: 'Tabla de ángulos y, debajo, los copys organizados por campo de Meta Ads.' },
];

// Skills que JARVIS traía antes y ya no. Si siguen en el vault sin cambios de la persona (autor: JARVIS),
// se mueven a .claude/skills-archivadas/ al arrancar: no se borran y se pueden recuperar moviéndolas de vuelta.
export const RETIRADAS = [
  'ganchos-contrarios', 'ganchos-historia', 'ganchos-pregunta', 'ganchos-numeros', 'ganchos-visuales', 'ganchos-anuncio',
  'ganchos-desde-transcripciones', 'titulos-youtube', 'guion-tutorial', 'guion-historia-personal', 'guion-lista',
  'guion-mito-realidad', 'guion-opinion', 'guion-youtube-largo', 'guion-anuncio-ugc', 'guion-teleprompter',
  'carrusel-lista', 'carrusel-antes-despues', 'carrusel-errores', 'carrusel-framework', 'carrusel-caso', 'carrusel-linkedin',
  'diseno-carrusel', 'historias-encuesta', 'historias-detras-camaras', 'historias-preguntas', 'historias-dia-a-dia',
  'historias-lanzamiento', 'historias-reactivar', 'reel-a-linkedin', 'reel-a-hilo-x', 'reel-a-threads', 'reel-a-newsletter',
  'reel-a-blog', 'reel-a-tiktok-shorts', 'reel-a-pinterest', 'caption-instagram', 'seo-instagram', 'ideas-desde-dudas',
  'ideas-tendencias', 'ideas-desde-comentarios', 'calendario-mensual', 'series-de-contenido', 'banco-de-historias',
  'ideas-colaboraciones', 'acortar-texto', 'mejorar-claridad', 'adaptar-tono', 'reescribir-con-mi-voz', 'corregir-texto',
  'simplificar-jerga', 'variaciones-ab', 'cta-comenta-palabra', 'cta-guardar-compartir', 'cta-venta-suave', 'cierres-reel',
  'respuesta-dm-automatica', 'bio-instagram', 'cta-seguir', 'informe-mensual', 'top-contenido', 'que-boostear',
  'diagnostico-cuenta', 'mejor-hora-publicar', 'aprender-de-fracasos', 'objetivos-kpis', 'analizar-competidor',
  'comparar-competidores', 'ganchos-competencia', 'huecos-de-contenido', 'analizar-referente', 'benchmark-formatos',
  'analizar-ad-library', 'angulos-anuncio', 'brief-creativo-anuncio', 'plan-campana-meta', 'analizar-rendimiento-ads',
  'publico-objetivo-meta',
];
