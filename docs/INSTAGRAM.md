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

## Automatizaciones (comentario → mensaje privado, como ManyChat)

En **Instagram → Automatizaciones**. Las envía [Zernio](https://zernio.com), que tiene la app de Meta aprobada: tú no
tienes que pasar la verificación de Meta.

1. Crea tu cuenta en zernio.com y conecta allí tu Instagram (cuenta de empresa o creador, vinculada a una página de Facebook).
2. Copia tu API key (zernio.com → API keys) y pégala en la pantalla de Automatizaciones, o ponla en el `.env` como
   `ZERNIO_API_KEY` (`npm run claves`). Si tienes varias cuentas de Instagram en Zernio, `ZERNIO_ACCOUNT_ID` elige cuál.
3. **Nueva automatización**:
   - **Cuándo se activa**: comentan una publicación o responden a una story. Puede ser **una concreta**, **cualquiera**
     o **la siguiente**: se queda esperando y se activa sola en cuanto sale tu próximo post o story (JARVIS lo mira cada
     2 minutos y justo después de publicar desde JARVIS; necesita Instagram conectado con Facebook).
   - **Palabras clave** (como palabra, con erratas, o exactas) y, si quieres, que también responda si te las escriben por privado.
   - **Respuesta pública** al comentario (varias, se elige una al azar).
   - **Mensaje privado** con un botón (`{{first_name}}` pone su nombre).
   - **Sígueme primero**: solo se lo envía si te sigue (con botón para confirmarlo y otro para ver tu perfil).
   - **El recurso**: el enlace. Sin pregunta, el botón del mensaje lo abre directamente.
   - **Pregunta** (opcional): al pulsar el botón le llega el recurso y la pregunta; su respuesta se guarda y la ves en
     **Resultados**, junto con quién la activó, los mensajes enviados y los clics.
4. **Pausar / Reanudar**, **Editar** y **Eliminar** desde cada tarjeta.

Límites de Meta: el mensaje privado sale una sola vez por comentario y como mucho 7 días después; tras el botón, solo
se le puede seguir escribiendo en las 24 horas siguientes a su último mensaje. Si tienes ManyChat u otro bot en la misma
cuenta con las mismas palabras, la persona recibiría dos mensajes.
