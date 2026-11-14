# Conectar Instagram a JARVIS

JARVIS lee tus métricas con la **API oficial de Instagram** (Graph API de Meta). No hace falta publicar tu app ni pasar revisión: en modo desarrollo funciona con tus propias cuentas.

**Requisitos**
- Cuenta de Instagram **profesional** (Empresa o Creador).
- Esa cuenta **vinculada a una página de Facebook** (en Instagram: *Configuración → Centro de cuentas* o desde la página de Facebook: *Configuración → Cuentas vinculadas*).
- Ser administrador de esa página.

> Meta cambia a menudo los nombres de los menús. Si algo no coincide exactamente, busca la opción con un nombre parecido.

---

## Opción rápida · Windsor.ai (sin app de Meta)

Si ya tienes tu Instagram conectado en [Windsor.ai](https://onboard.windsor.ai), JARVIS lee de ahí tus métricas:

1. Copia tu API key en onboard.windsor.ai.
2. En la carpeta de JARVIS: `npm run claves` y pégala en `WINDSOR_API_KEY` (al final de la lista).
3. Reinicia JARVIS (`powershell -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar`) y pulsa **Sincronizar** en la pestaña Instagram.

La primera vez trae un año de publicaciones y tarda un poco: además comprueba qué métricas tiene tu plan de Windsor (las pide todas y se queda con las que existen). Después se actualiza sola cada 6 horas. Trae:

- **Cada publicación**: alcance, visualizaciones, me gusta, comentarios, guardados, compartidos, interacciones, tiempo medio de visualización de los reels y el resto de métricas que dé Windsor.
- **La cuenta, día a día**: seguidores, seguidores nuevos, alcance, impresiones, visitas al perfil, cuentas que interactúan, clics en la web y en los botones de contacto, toques en enlaces…
- **Historias**: alcance, visualizaciones, respuestas, toques para avanzar o volver y salidas.

Si en Windsor tienes varias cuentas de Instagram, pon la tuya en `.env`: `WINDSOR_CUENTA=tu_usuario`.

Lo que Windsor **no** sustituye: la pestaña **Competencia** y la Ad Library de **Meta Ads** necesitan la conexión con Facebook (opción A), porque Windsor no da datos de otros perfiles. Puedes tener las dos: entonces JARVIS usa la de Meta y Windsor completa las métricas que faltan.

## Opción A · Botón "Conectar con Facebook" (recomendada)

### 1. Crea la app de Meta
1. Entra en [developers.facebook.com](https://developers.facebook.com) con tu cuenta de Facebook (la que administra la página) y pulsa **Mis apps → Crear app**.
2. Ponle de nombre algo como `JARVIS` y tu email.
3. En el tipo de uso elige **Otro** y, después, el tipo **Empresa**. Si te ofrece casos de uso, elige el de gestionar Instagram o páginas.
4. Si te pide un portfolio comercial (Business Manager), elige el tuyo o déjalo en blanco.

### 2. Añade el inicio de sesión con Facebook
1. En el panel de la app, añade el producto **Inicio de sesión con Facebook para empresas** (o **Inicio de sesión con Facebook**, si es el que aparece).
2. En sus **Ajustes**, en *URI de redireccionamiento de OAuth válidos*, añade exactamente:
   ```
   http://localhost:3333/api/instagram/callback
   ```
3. Si el producto es **para empresas**, crea una **Configuración** con estos permisos y copia su **ID de configuración**:
   `instagram_basic`, `instagram_manage_insights`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`, `ads_read`, `ads_management`.
   (`instagram_content_publish` es para publicar desde JARVIS más adelante: pedirlo ahora evita tener que reconectar.)

### 3. Copia las claves en `.env`
Ejecuta `npm run claves` en la carpeta de JARVIS y pega el **Identificador de la app** y la **Clave secreta** (en **Configuración de la app → Básica**) y, si usas "para empresas", el **ID de configuración**. Si prefieres editar `.env` a mano:
```
META_APP_ID=123456789012345
META_APP_SECRET=abcdef0123456789...
META_CONFIG_ID=987654321   # solo si usas "para empresas"
```
Reinicia JARVIS: `powershell -ExecutionPolicy Bypass -File instalar.ps1 -Reiniciar`.

### 4. Conecta
En la pestaña **Instagram** pulsa **Conectar con Facebook**, acepta los permisos y elige tu página. JARVIS vuelve solo y empieza a sincronizar.

---

## Opción B · Pegar un token (plan B si la opción A da guerra)
1. Abre el [Explorador de la API Graph](https://developers.facebook.com/tools/explorer/).
2. Arriba a la derecha elige tu app (la de la opción A).
3. En **Permisos** añade los mismos de arriba y pulsa **Generate Access Token**. Acepta.
4. Copia el token y pégalo en la pestaña **Instagram** → *…o pega un token de acceso de Meta* → **Conectar**.

Si además tienes `META_APP_ID` y `META_APP_SECRET` en `.env`, JARVIS lo convierte en un token que no caduca. Si no, el token del explorador dura solo unas horas.

---

## Publicar en Instagram desde JARVIS

Con Instagram conectado con Facebook (opción A o B, con el permiso `instagram_content_publish`), JARVIS publica las piezas que **tú** marcas en la pestaña **Contenido**. Nadie más puede activarlo: ni Hermes por Telegram ni Claude Code.

**Antes, una vez:** Instagram no puede entrar en tu PC, así que descarga cada vídeo o foto de un enlace público. JARVIS los sube justo antes a Supabase (un bucket público llamado `contenido`, carpeta `jarvis/`, que permita subir con la clave anon) y los borra al publicarse. Pon la conexión con `npm run claves` → `CRM_SUPABASE_URL` y `CRM_SUPABASE_ANON_KEY` (Supabase → Project Settings → API) y reinicia JARVIS.

**Cómo se usa**
1. Abre la pieza (o créala), sube el vídeo o las fotos y ponle día, hora y caption.
2. Marca **«Publicar sola en Instagram el día y la hora de arriba»** y guarda. JARVIS te dice al momento si falta algo.
3. A esa hora se publica sola y la pieza pasa a *Publicado*, con el enlace a la publicación. O pulsa **«Publicar ahora en Instagram»** (te pide confirmación).

**Qué se publica como qué**
| Tipo de la pieza | En Instagram |
|---|---|
| Reel, Reel split, B-roll, Short | Reel (1 vídeo MP4 o MOV) |
| Post | Foto (1 JPG) o reel si es un vídeo |
| Carrusel | Carrusel (de 2 a 10 fotos o vídeos) |
| Story | Historia (1 foto o vídeo, sin caption) |

**Mientras se publica**, arriba en Contenido ves en qué paso va (subiendo el archivo, Instagram procesando, publicando…) y, al terminar, el aviso con el enlace. Si falla, sale en rojo con el motivo y el botón **Abrir**.

**Volver a publicar:** lo publicado no desaparece. En **Biblioteca → Publicados** (o en la ficha de la pieza) pulsa **«Volver a publicar»**: JARVIS hace una copia con los mismos archivos y caption y eliges el día.

**A tener en cuenta**
- **JARVIS tiene que estar abierto** a la hora de publicar. Si el PC está apagado, publica en cuanto lo abras.
- Instagram solo publica **fotos en JPG**. Las PNG o WebP que subes ahora se convierten solas; para las antiguas, el editor tiene el botón **«Convertir las imágenes a JPG»**.
- Si algo falla, la pieza lo dice («No se pudo publicar: …»). Corrígelo y guarda: se vuelve a intentar.
- El plan gratis de Supabase admite archivos de hasta **50 MB**: exporta los reels más ligeros si te pasas.

## Qué hace JARVIS después
- **Sincroniza cada 6 horas** (cámbialo con `IG_SYNC_HORAS`) tus últimas 150 publicaciones: alcance, visualizaciones, interacciones, guardados, compartidos y tiempo medio de visualización de los reels. También guarda el alcance diario y los seguidores nuevos de la cuenta.
- **Transcribe tus reels** con ElevenLabs (si tienes `ELEVENLABS_API_KEY`) y los guarda en `03-Transcripciones/` con sus métricas. Como mucho transcribe 10 por sincronización (`IG_TRANSCRIBIR_MAX`) para no gastar créditos de golpe.
- **Une cada publicación con su pieza** de Contenido (las que publica JARVIS, por el enlace, por el caption o, si no hay duda, por el día y el formato) para que veas sus resultados en la ficha y en Instagram → **Qué me funciona**. Con Facebook y Windsor a la vez no se duplica nada: las dos fuentes rellenan la misma publicación (lo que una no trae, lo pone la otra).
- **Cada lunes escribe el informe** de la semana pasada en `07-Diario/`.
- **Clasifica los temas** de tus publicaciones con Claude Haiku y, cuando tiene 5 transcripciones o más, **crea tu perfil de voz** (`_voz.md`). Lo hace en segundo plano; si no quieres estas tareas automáticas, pon `JARVIS_AUTO=0`.

## Problemas frecuentes
| Mensaje | Solución |
|---|---|
| *No encuentro ninguna página con una cuenta de Instagram profesional* | La cuenta no es profesional, no está vinculada a la página o no marcaste esa página al dar permisos. Vuelve a conectar y marca la página. |
| *La conexión con Instagram ha caducado* | Vuelve a conectar (botón o token). Con App ID y secreto el token de página no caduca. |
| *Falta un permiso en la app de Meta* | Añade el permiso que indica a la configuración o al token y vuelve a conectar. |
| *URL bloqueada* o *redirect_uri* al conectar | La URI del paso 2 no coincide exactamente. Revisa `http://localhost:3333/api/instagram/callback`. |
| Faltan visualizaciones en algunas publicaciones | Meta no da todas las métricas para todos los tipos ni para publicaciones muy antiguas. JARVIS guarda las que hay. |

## Manychat: automatizaciones, bandeja, contactos y plantillas

Todo está en la sección **Manychat** (arriba, junto a Instagram), en cinco pestañas: Automatizaciones, Bandeja de
entrada, Contactos, Plantillas y Configuración.

### Automatizaciones (comentario → mensaje privado)

En **Manychat → Automatizaciones**. Las envía [Zernio](https://zernio.com), que tiene la app de Meta aprobada: tú no
tienes que pasar la verificación de Meta.

1. Crea tu cuenta en zernio.com y conecta allí tu Instagram (cuenta de empresa o creador, vinculada a una página de Facebook).
2. Copia tu API key (zernio.com → API keys) y pégala en la pantalla de Automatizaciones, o ponla en el `.env` como
   `ZERNIO_API_KEY` (`npm run claves`). Si tienes varias cuentas de Instagram en Zernio, `ZERNIO_ACCOUNT_ID` elige cuál.
3. **Nueva automatización** abre el **tablero** solo con el disparador: los bloques los vas añadiendo tú (arriba),
   unidos con flechas, tan largo como quieras. En todos los textos tienes el botón 😀 para poner emojis.
   - **Cuando…** (el disparador): comentan una publicación, responden a una story o te escriben una palabra por
     privado. Para publicaciones y stories: **una concreta**, **cualquiera** o **la siguiente** (se queda esperando y se
     activa sola en cuanto sale tu próximo post o story; necesita Instagram conectado con Facebook). Palabras clave
     (da igual mayúsculas, minúsculas y tildes), respuesta pública al comentario (varias, al azar), **sígueme primero**
     y si se repite. Si marcas **Sígueme primero**, sale como un cuadro justo después del disparador (pulsa en él
     para cambiar sus textos): a todos les llega primero ese mensaje con «Ya te sigo» y «Ver perfil»; al pulsar se
     comprueba si te sigue y, si sí, sigue el flujo; si no, le llega «Si aún no te sigue» para volver a intentarlo.
   - **Mensaje**: texto (`{{first_name}}` pone su nombre) y hasta 3 botones: de **enlace** (puedes elegir uno de tus
     lead magnets) o que **siguen un camino**. El primero tras un comentario es la respuesta privada: para seguir, la
     persona tiene que pulsar un botón (Meta no deja escribirle más hasta que responda).
   - **Pregunta**: guarda la respuesta (la ves en **Resultados**); con respuestas rápidas, un camino por opción.
   - **Esperar**: segundos, minutos, horas o días. Justo después del disparador es lo que tarda la respuesta privada
     (aquí valen los segundos); más adelante Zernio espera como mínimo 1 minuto. Puede enviar **solo dentro de un
     horario** (p. ej. de 9:00 a 21:00, hora de España): si toca fuera, vuelve a mirar cada 15 minutos (consulta la hora
     en timeapi.io; si no responde, envía igual).
   - **Condición** (tiene una etiqueta, te sigue, su mensaje contiene…), **Etiqueta** y **Fin**.
   Arrastra desde un punto ● hasta otro bloque para unirlos; selecciona una flecha y pulsa Supr para quitarla.
   **Desde el chat de JARVIS o por Telegram** también vale: «hazme una automatización para la siguiente publicación con
   la palabra GUÍA que mande mi lead magnet de prompts y pregunte a qué se dedica». JARVIS diseña el flujo
   (`crear_automatizacion`) y lo deja **en pausa**: revísalo en el tablero y pulsa **Reanudar** para activarlo.
4. En cada tarjeta: **Abrir tablero**, **Pausar / Reanudar**, **Resultados**, **Duplicar** (la copia queda en pausa) y **Eliminar**.
5. **Embudo** (botón de arriba): por cada automatización, cuántos la activaron, a cuántos les llegó, cuántos
   pulsaron un botón y cuántos llegaron al final, con el % de cada paso.

Límites de Meta: el mensaje privado sale una sola vez por comentario y como mucho 7 días después; después, solo se le
puede escribir en las 24 horas siguientes a su último mensaje (una espera más larga puede hacer que no llegue). Si
tienes ManyChat u otro bot en la misma cuenta con las mismas palabras, la persona recibiría dos mensajes.

Cómo se monta en Zernio: el primer mensaje es una «comment automation» (respuesta pública, sígueme primero, botones) y
cada botón con camino arranca un «workflow» con lo que cuelga de él; «por privado» es un solo workflow. Si los cambias
en la web de Zernio, al guardar en JARVIS se sobrescriben.

### Bandeja de entrada

Los chats de Instagram (y de Facebook o WhatsApp si los conectas en Zernio), con filtros: abiertos o cerrados, no
leídos, por etiqueta y buscador. Al abrir uno ves la conversación, puedes responder (con emojis, una plantilla o botones
con enlace) y a la derecha tienes a la persona: si te sigue, sus etiquetas (añadir y quitar), **Pausar automatizaciones**
(30 min, 1 h, 4 h, 24 h o hasta que la reanudes, para hablar tú sin que salte el bot), **Bloquear**, **Ficha** y
**Cerrar** (pasa a «Cerrados»; si la persona vuelve a escribir, se reabre sola).
Meta deja responder 24 h después de su último mensaje; pasado eso, JARVIS lo envía como respuesta de una persona
(`HUMAN_AGENT`), que Meta permite hasta 7 días. Encima del cuadro de texto ves cuánto tiempo te queda. No se puede
escribir primero a alguien que nunca te ha escrito.

### Contactos

Todas las personas que han pasado por tus automatizaciones o te han escrito, con filtros (buscador, etiqueta,
automatización en la que entró, suscritos / en pausa / bloqueados y fecha de alta). **Descargar CSV** baja exactamente
lo filtrado (se abre en Excel o Google Sheets, separado por `;`) con estas columnas: usuario, enlace a su perfil
de Instagram, fecha de entrada (cuando pidió su primer recurso), fecha del último mensaje, **cuántos recursos ha pedido**
y cuáles. Si de alguien no se conoce el usuario (Zernio a veces solo da su nombre visible), sale su nombre. El filtro
«automatización» usa también estos recursos pedidos. Los recursos salen de lo que comentaron en tus automatizaciones y de los flujos
en los que entraron; JARVIS los va guardando (cada pocos minutos y al descargar), así que no se pierden aunque Zernio
solo enseñe los últimos. Pulsa en una persona para ver su ficha: datos, etiquetas, recursos pedidos con fecha, campos y
respuestas, todo el historial de mensajes y **Abrir el chat**.

### Pipeline de ventas

En **Contactos** puedes cambiar entre **Lista** y **Pipeline**. El pipeline tiene una columna por fase: Iniciada,
Conexión, Descubrimiento, Cualificación, Propuesta de llamada, Pendiente de agendar, Agendado, Ganado y Perdido.
Arrastra una tarjeta para moverla (o cambia la fase desde la ficha). Con **Columnas** añades las tuyas, las renombras,
las reordenas y escribes **cuándo pasa alguien ahí**; las predeterminadas no se pueden borrar.

**Mover solas con IA** (activado por defecto): cada 15 minutos JARVIS lee las conversaciones con mensajes nuevos (como
mucho 12 cada vez) y, con Claude Code, decide en qué fase está cada persona según el «cuándo pasa aquí» de cada
columna. Reglas: solo mueve hacia delante (o a Ganado/Perdido), nunca saca a nadie de Ganado o Perdido, y si moviste
tú a alguien no lo toca hasta que haya mensajes nuevos. En la tarjeta verás ✦ y el motivo. **Leer conversaciones
ahora** lo hace al momento. Necesita Claude Code con la sesión iniciada en el VPS (usa el modelo más ligero).

### Tareas

En la ficha de una persona (Contactos, Pipeline o Bandeja → **Ficha**) puedes asignarle una tarea con fecha. Todas
salen en **Manychat → Tareas** (tarea, persona y fecha; atrasadas en rojo) y también en las tareas de JARVIS, en la
categoría **Ventas**.

### Plantillas

Respuestas que repites (precio, cómo funciona, enlace a la llamada…), con carpeta y hasta 3 botones con enlace. Se
pegan en la bandeja (botón **Plantilla**) y en los bloques Mensaje del tablero (**Usar plantilla**).

### Configuración

- **Bloqueos**: escribe el usuario de Instagram (o pega el enlace a su perfil) y nunca se le activará ninguna
  automatización. Si aún no te ha escrito, queda *pendiente* y se aplica solo en cuanto aparezca (JARVIS lo mira cada
  5 minutos). Cómo funciona: la persona queda bloqueada en Zernio y con la etiqueta `jarvis-bloqueado`, y todos los
  flujos comprueban esa etiqueta antes del primer paso (al guardar JARVIS actualiza solo las automatizaciones que ya
  tenías). La primera respuesta privada a un comentario la manda Zernio directamente; JARVIS la marca como bloqueada en
  Zernio para que no la envíe, pero si alguna vez llegara, el resto del flujo ya no sigue.
- **Canales**: las cuentas conectadas en Zernio. Facebook y WhatsApp se conectan en zernio.com.
- **Campos personalizados**: ver y crear (texto, número, fecha, sí/no o lista de opciones).
- **Etiquetas**: las que usan tus contactos y cuántos tiene cada una.

Etiquetas internas que pone JARVIS y no se muestran: `jarvis-bloqueado`, `jarvis-pausado` y `jarvis-auto-<n>`
(en qué automatización entró, para el filtro y el embudo).
