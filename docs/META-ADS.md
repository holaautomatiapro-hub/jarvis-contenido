# Meta Ads en JARVIS

La pestaña **Meta Ads** y el asistente de anuncios (también desde Telegram) usan la **misma conexión que Instagram** (ver [INSTAGRAM.md](INSTAGRAM.md)). Ya incluye los permisos `ads_read` y `ads_management`.

## La regla de oro
1. JARVIS **solo propone** campañas: deja un *borrador* en la pestaña Meta Ads.
2. Tú lo revisas y pulsas **Crear en pausa**. Entonces se crean en Meta la campaña, el conjunto de anuncios y el anuncio, **todo en pausa**.
3. **Activarla lo haces tú** en el Administrador de anuncios (el borrador creado te deja el enlace directo).

Ni el chat ni Telegram tienen ninguna herramienta para crear ni para activar campañas: solo para proponer. Además, el código bloquea cualquier intento de crear algo que no esté en pausa, y hay un tope de presupuesto diario (`ADS_PRESUPUESTO_MAX_DIA`, 50 € por defecto).

## Lo que necesitas (cuando quieras activarlo)

### 1. La cuenta publicitaria
En la pestaña Meta Ads pulsa **Elegir cuenta publicitaria** y elígela de la lista. También puedes pegar su ID: lo ves en el [Administrador de anuncios](https://adsmanager.facebook.com) arriba a la izquierda o en la URL (`act=123456789`). O ponlo en `.env`:
```
META_AD_ACCOUNT_ID=act_123456789
```
Tu usuario de Facebook tiene que tener acceso a esa cuenta (en el Business Manager: *Configuración → Cuentas publicitarias → Personas*).

### 2. La Ad Library (anuncios de tu competencia)
Meta obliga a **verificar tu identidad** una sola vez para usar la API de la biblioteca de anuncios:
1. Ve a [facebook.com/ID](https://www.facebook.com/ID) y sigue los pasos con tu DNI o pasaporte (tarda desde minutos hasta un par de días).
2. Entra en [facebook.com/ads/library/api](https://www.facebook.com/ads/library/api) y acepta las condiciones.

En la UE la Ad Library devuelve **todos** los anuncios (no solo los políticos), con su alcance en la UE.

### 3. Las páginas de Facebook de tu competencia
La Ad Library busca por **páginas de Facebook**, no por perfiles de Instagram. En *Creativos de la competencia → Configurar páginas de Facebook* pon, para cada competidor, el **nombre** de su página o, mejor aún, su **ID** (aparece en la biblioteca de anuncios, en la URL de la página del anunciante: `view_all_page_id=…`). Si no pones nada, JARVIS busca por el nombre de su perfil de Instagram.

## Administrador de anuncios

En la pestaña **Meta Ads**, el panel **Administrador de anuncios** enseña lo mismo que el de Meta, sin salir de JARVIS (solo lectura: los cambios se hacen en Meta):

- **Cualquier cuenta**: las tuyas y las de cada Business Manager al que tienes acceso (propias y de clientes; necesita el permiso `business_management`, que ya pide la conexión de Instagram). La que eliges en «Cambiar cuenta» es la principal; las demás se miran desde el desplegable del panel.
- **Campañas → conjuntos → anuncios**: pulsa en un nombre para bajar de nivel. Búsqueda, solo activas, con gasto, archivadas y cualquier periodo (o fechas a tu elección).
- **Columnas**: elige qué métricas ver y en qué orden (resultados y coste por resultado, gasto, alcance, frecuencia, CTR, CPC, CPM, leads, conversaciones, ThruPlays, hook rate, hold rate, ROAS, clasificaciones de calidad… y cualquier acción que registre Meta). Hay combinaciones rápidas (Rendimiento, Interacción, Vídeo, Leads y mensajes, Ventas) y se guardan para el ordenador y el móvil.
- **Detalle**: de cada campaña, conjunto o anuncio, todas sus métricas, el día a día, el reparto por edad, sexo, ubicación y dispositivo, el creativo (texto, título, botón, enlace y vista previa) y, en un conjunto, a quién se dirige.

El asistente también lo usa (herramientas `ads_cuentas`, `ads_explorar` y `ads_detalle`): «¿qué anuncio de la campaña de leads tiene mejor coste por lead?», «¿qué edad me sale más barata?».

## Anuncios de la competencia
En la pestaña **Meta Ads**, abajo, busca una cuenta de tu competencia (nombre, @usuario, enlace de su página o de la Biblioteca de anuncios), elige su página y verás **todos sus anuncios activos**:
- Ordena por **más tiempo activos** (los que mantienen: los que les funcionan), **más variantes** (el mismo texto en varios anuncios: lo están escalando), **más alcance** en la UE o **más nuevos**, y filtra por antigüedad (+7, +30, +90 días).
- Al abrir uno: su vídeo o sus imágenes (si Meta no deja sacarlos, ábrelo en la Biblioteca o sube tú el vídeo), todo su texto, **Transcribir el vídeo** (ElevenLabs o Whisper gratis; queda en 04-Competencia) y **Adaptar a mi estilo** (JARVIS escribe tu versión y la deja en Contenido → Pipeline).
- **Actualizar** vuelve a mirar sus anuncios activos; los que ya no salen se quitan.

## Qué puedes pedir
- *"¿Cuánto gasté este mes en la campaña de TOFU y con qué CTR y CPC?"*
- *"¿Qué reel debería impulsar?"*: mira tus publicaciones que se guardan, comparten e interactúan más que tu media.
- *"¿Qué ángulos usa mi competencia en sus anuncios?"*: los anuncios que llevan más días activos suelen ser los que les funcionan.
- *"Créame una campaña para mi mejor reel con 10 € al día durante una semana"*: deja el borrador para que lo confirmes.

## Objetivos disponibles
- **Interacción**: más interacción con la publicación (impulsar un reel o un carrusel).
- **Alcance**: llegar a más gente.

Campañas de mensajes, tráfico o clientes potenciales, por ahora, desde el Administrador de anuncios.

## Problemas frecuentes
| Mensaje | Solución |
|---|---|
| *Falta un permiso en la app de Meta (ads_…)* | Vuelve a conectar Instagram aceptando los permisos de anuncios. |
| *La Ad Library necesita que verifiques tu identidad* | Pasos del punto 2. |
| *No se pudo crear el conjunto de anuncios: …* | Meta explica el motivo (público pequeño, presupuesto mínimo…). Lo creado hasta ese paso queda **en pausa**: puedes borrarlo en el Administrador. |
| *La conexión ha caducado* | El token de usuario de Facebook dura 60 días: vuelve a conectar desde la pestaña Instagram. |
