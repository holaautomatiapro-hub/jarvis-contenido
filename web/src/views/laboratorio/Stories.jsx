import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { diaCorto } from '../../lib/fechas.js';
import { Modal } from '../contenido/comun.jsx';
import ProgramarStories from '../contenido/ProgramarStories.jsx';

// Stories: de un carrusel, un reel o un tema, JARVIS escribe el guion de la secuencia de stories (lo cambias a mano o
// se lo pides de nuevo), con tu CLAUDE.md y tus ejemplos. Las stories las haces tú y aquí las subes y las programas
// para que se publiquen solas en Instagram.

const ORIGENES = ['Carrusel', 'Reel', 'Short', 'Reel split', 'B-roll', 'Post'];
const nStories = (g) => (g.match(/^##\s*Story/gim) || []).length;

// «Guion de stories» desde la ficha de una pieza: se abre aquí con esa pieza elegida
let piezaPendiente = null;
export const storiesDePieza = (id) => { piezaPendiente = id; window.dispatchEvent(new CustomEvent('jarvis:stories-de')); };

const PLANTILLA_ESTILO = `# Mi estilo de stories

## Voz y tono
- Cómo hablo en stories (cercano, directo, con humor…), cómo me dirijo a quien me ve.

## Estructura de una secuencia
- Cuántas stories suelo hacer y qué hace cada una (gancho, desarrollo, prueba, CTA).

## Textos en pantalla
- Cuántas palabras como mucho, mayúsculas o no, emojis sí o no, palabras que resalto.

## Diseño visual
- Fondo (foto mía, color liso, captura…), colores, tipografías, dónde va el texto y a qué tamaño.
- Si salgo yo: cómo (cara a cámara, recortado, foto pequeña en una esquina…).

## Stickers e interacción
- Qué stickers uso (encuestas, cajas de preguntas, quiz…) y cómo los formulo.

## CTA y palabras clave
- Cómo cierro (responde con una palabra, enlace, ir al post) y mis palabras clave.

## Lo que nunca hago
- …
`;

// Tu guía de estilo de stories (Stories/CLAUDE.md en tu vault): JARVIS la sigue al escribir los guiones y Claude al
// diseñarlas. Se escribe aquí, se sube un .md o se edita en Obsidian.
// Tus stories de ejemplo: se suben al momento (no hace falta Guardar) y Claude las mira antes de diseñar
function EjemplosStories({ ejemplos, onCambio }) {
  const [lista, setLista] = useState(ejemplos);
  const [subiendo, setSubiendo] = useState(0);
  const [error, setError] = useState('');
  const input = useRef(null);
  const subir = async (files) => {
    const imgs = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
    if (!imgs.length) return setError('Sube imágenes (JPG, PNG o WebP). Si tu story es un vídeo, haz una captura.');
    setError('');
    for (const f of imgs) {
      setSubiendo((n) => n + 1);
      try {
        const r = await fetch(`/api/stories/ejemplos?nombre=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `No se pudo subir «${f.name}»`);
        setLista(j); onCambio();
      } catch (e) { setError((x) => (x ? `${x}\n` : '') + e.message); }
      setSubiendo((n) => n - 1);
    }
  };
  const borrar = async (e) => {
    try { setLista(await api(`/api/stories/ejemplos/${encodeURIComponent(e.fichero)}`, { method: 'DELETE' })); onCambio(); } catch (err) { setError(err.message); }
  };
  return (
    <div className="estilo-ejemplos">
      <div className="estilo-ejemplos-cab">
        <div><b>Stories de ejemplo</b><span className="ayuda"> · capturas de tus stories (hasta 12). JARVIS las mira al escribir los guiones para que suenen y se estructuren como las tuyas.</span></div>
        <button type="button" className="btn btn-sec" onClick={() => input.current?.click()} disabled={subiendo > 0 || lista.length >= 12}><Icon name="plus" size={14} />{subiendo ? `Subiendo ${subiendo}…` : 'Añadir'}</button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { subir(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="estilo-ejemplos-grid" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); subir(e.dataTransfer.files); }}>
        {lista.map((e) => (
          <div key={e.fichero} className="estilo-ejemplo">
            <img src={e.url} alt="" loading="lazy" />
            <button type="button" onClick={() => borrar(e)} aria-label="Quitar este ejemplo" title="Quitar este ejemplo">✕</button>
          </div>
        ))}
        {!lista.length && <button type="button" className="estilo-ejemplo-vacio" onClick={() => input.current?.click()}>Arrastra aquí capturas de tus stories o pulsa para elegirlas</button>}
      </div>
      {error && <div className="caja-error">{error}</div>}
    </div>
  );
}

function EstiloStories({ estilo, ejemplos, onClose, onGuardado, onEjemplos }) {
  const [texto, setTexto] = useState(estilo.texto);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const input = useRef(null);
  const subir = async (f) => {
    if (!f) return;
    if (f.size > 200_000) return setError('Ese archivo es demasiado grande para una guía de estilo.');
    setTexto(await f.text()); setError('');
  };
  const guardar = async () => {
    setGuardando(true); setError('');
    try { onGuardado(await api('/api/stories/estilo', { method: 'PUT', body: { texto, modificado: estilo.modificado } })); }
    catch (e) { setError(e.message); setGuardando(false); }
  };
  return (
    <Modal titulo={<><Icon name="doc" size={14} />Tu estilo de stories</>} onClose={onClose} ancho={760} cerrarFuera={false}>
      <EjemplosStories ejemplos={ejemplos} onCambio={onEjemplos} />
      <div className="estilo-ejemplos-cab" style={{ marginTop: 14 }}><b>CLAUDE.md</b></div>
      <p className="ayuda">Cuéntale a JARVIS cómo son tus stories: tono, estructura, textos, diseño, stickers y CTA. Lo sigue al escribir cada guion de stories (aquí y en la ficha de cada story). Se guarda en tu vault, en <b>{estilo.ruta}</b> (también puedes editarlo en Obsidian); los ejemplos, en Stories/ejemplos.</p>
      <div className="estilo-barra">
        <button type="button" className="btn btn-sec" onClick={() => input.current?.click()}><Icon name="share" size={14} />Subir un .md</button>
        {!texto.trim() && <button type="button" className="btn btn-sec" onClick={() => setTexto(PLANTILLA_ESTILO)}><Icon name="doc" size={14} />Empezar con una plantilla</button>}
        <input ref={input} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <textarea className="campo stories-guion" rows={14} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="# Mi estilo de stories&#10;- Máximo 12 palabras por story&#10;- Fondo con foto mía y texto en blanco arriba&#10;- Siempre cierro con «responde YO»…" />
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <span className="ayuda">{texto.length.toLocaleString('es-ES')} caracteres</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn" onClick={texto === estilo.texto ? onClose : guardar} disabled={guardando}>{guardando ? 'Guardando…' : texto === estilo.texto ? 'Listo' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}

function NuevoGuion({ data, piezas, inicial, onClose, onCreado }) {
  const candidatas = useMemo(() => piezas.filter((p) => ORIGENES.includes(p.formato))
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || b.id - a.id), [piezas]);
  const [origen, setOrigen] = useState(inicial || candidatas.length ? 'pieza' : 'tema');
  const [piezaId, setPiezaId] = useState(inicial || candidatas[0]?.id || '');
  const [tema, setTema] = useState('');
  const [titulo, setTitulo] = useState('');
  const [objetivo, setObjetivo] = useState(inicial ? 'promo' : '');
  const [cantidad, setCantidad] = useState(5);
  const [indicaciones, setIndicaciones] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const crear = async () => {
    if (origen === 'pieza' && !piezaId) return setError('Elige el carrusel o el reel.');
    if (origen === 'tema' && !tema.trim()) return setError('Escribe de qué van las stories.');
    setEnviando(true); setError('');
    try {
      const r = await api('/api/stories', { method: 'POST', body: {
        titulo: titulo.trim() || undefined, objetivo: objetivo || undefined, cantidad, indicaciones: indicaciones.trim() || undefined,
        ...(origen === 'pieza' ? { pieza_id: Number(piezaId) } : origen === 'tema' ? { tema } : { escribirConJarvis: false, titulo: titulo.trim() || 'Mis stories' }),
      } });
      onCreado(r);
    } catch (e) { setError(e.message); setEnviando(false); }
  };
  const etiqueta = (p) => `${p.formato} · ${p.titulo}${p.estado === 'publicado' || p.ig_estado === 'publicado' ? ' (publicado)' : p.fecha ? ` (${diaCorto(p.fecha)})` : ''}`;
  return (
    <Modal titulo={<><Icon name="layers" size={14} />Nuevo guion de stories</>} onClose={onClose} ancho={640}>
      <label className="campo-et">De dónde salen</label>
      <div className="seg seg-ancho seg-mini">
        <button type="button" className={origen === 'pieza' ? 'on' : ''} onClick={() => setOrigen('pieza')} disabled={!candidatas.length}>De un carrusel o reel</button>
        <button type="button" className={origen === 'tema' ? 'on' : ''} onClick={() => setOrigen('tema')}>De un tema</button>
        <button type="button" className={origen === 'mano' ? 'on' : ''} onClick={() => setOrigen('mano')}>Lo escribo yo</button>
      </div>
      {origen === 'pieza' && (
        <select className="campo" value={piezaId} onChange={(e) => setPiezaId(e.target.value)} style={{ marginTop: 8 }} aria-label="Carrusel o reel">
          {candidatas.map((p) => <option key={p.id} value={p.id}>{etiqueta(p)}</option>)}
        </select>
      )}
      {origen === 'tema' && <textarea className="campo" rows={3} value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ej.: los 3 errores que cometen los entrenadores al contestar DMs, y que me escriban SETTER" style={{ marginTop: 8 }} />}
      {origen !== 'mano' && (
        <>
          <label className="campo-et">Para qué son</label>
          <div className="pildoras stories-objetivos">
            {Object.entries(data.objetivos).map(([id, txt]) => (
              <button key={id} type="button" className={`chip${objetivo === id ? ' chip-acento' : ''}`} onClick={() => setObjetivo(objetivo === id ? '' : id)} title={txt}>{txt.split(':')[0]}</button>
            ))}
          </div>
          <div className="dos-col">
            <div>
              <label className="campo-et">Cuántas stories</label>
              <select className="campo" value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))}>{[3, 4, 5, 6, 7, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </div>
            <div>
              <label className="campo-et">Título <small className="t-dim">(opcional)</small></label>
              <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Si lo dejas vacío, el de la pieza o el tema" maxLength={120} />
            </div>
          </div>
          <label className="campo-et">Indicaciones para JARVIS <small className="t-dim">(opcional)</small></label>
          <textarea className="campo" rows={2} value={indicaciones} onChange={(e) => setIndicaciones(e.target.value)} placeholder="Ej.: palabra clave SETTER; una encuesta en la 2; que la última lleve al carrusel" />
        </>
      )}
      {origen === 'mano' && (
        <>
          <label className="campo-et">Título</label>
          <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Mis stories" maxLength={120} />
        </>
      )}
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <span className="ayuda">{origen === 'mano' ? 'Se crea vacío y lo escribes tú.' : 'JARVIS lo escribe con tu voz en uno o dos minutos.'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn" onClick={crear} disabled={enviando}><Icon name="sparkle" size={14} />{enviando ? 'Enviando…' : origen === 'mano' ? 'Crear' : 'Escribir el guion'}</button>
        </div>
      </div>
    </Modal>
  );
}

function Detalle({ g, piezas, ig, onAbrir, recargar, onBorrado }) {
  const [texto, setTexto] = useState(g.guion);
  const [pedido, setPedido] = useState('');
  const [programando, setProgramando] = useState(false);
  const [hecho, setHecho] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [aviso, setAviso] = useState('');
  // Lo que llega de JARVIS sustituye a lo de la caja si no lo estás cambiando
  const [base, setBase] = useState(g.guion);
  useEffect(() => { if (g.guion !== base) { if (texto === base) setTexto(g.guion); setBase(g.guion); } }, [g.guion]); // eslint-disable-line react-hooks/exhaustive-deps
  const cambiado = texto !== g.guion;
  const escribiendo = g.estado === 'escribiendo';
  const hacer = async (que, fn) => {
    setOcupado(que); setAviso('');
    try { await fn(); recargar(); } catch (e) { setAviso(e.message); }
    setOcupado('');
  };
  const guardar = () => hacer('guardar', () => api(`/api/stories/${g.id}`, { method: 'PUT', body: { guion: texto } }));
  const pedir = () => hacer('jarvis', async () => {
    if (cambiado) await api(`/api/stories/${g.id}`, { method: 'PUT', body: { guion: texto } });
    await api(`/api/stories/${g.id}/escribir`, { method: 'POST', body: { indicaciones: pedido } });
    setPedido('');
  });
  const borrar = () => {
    if (!window.confirm(`¿Borrar el guion «${g.titulo}»? Las stories que ya subiste se quedan en el calendario.`)) return;
    hacer('borrar', async () => { await api(`/api/stories/${g.id}`, { method: 'DELETE' }); onBorrado(); });
  };
  const n = nStories(texto);
  return (
    <div className="stories-detalle">
      <div className="panel panel-pad">
        <div className="panel-head">
          <div>
            <div className="label">{g.pieza ? `Stories · de «${g.pieza.titulo}» (${g.pieza.formato})` : g.tema ? 'Stories · de un tema' : 'Stories'}</div>
            <h2 className="diseno-titulo">{g.titulo}</h2>
          </div>
          <div className="diseno-acciones-cab">
            {g.pieza && <button type="button" className="link-btn" onClick={() => { const p = piezas.find((x) => x.id === g.pieza.id); if (p) onAbrir(p); }}>Ver la pieza</button>}
            <button type="button" className="link-btn peligro" onClick={borrar} disabled={escribiendo || Boolean(ocupado)}>Borrar</button>
          </div>
        </div>

        <div className="stories-paso"><span className="stories-n">1</span><b>Guion</b><span className="t-dim">{n ? `${n} ${n === 1 ? 'story' : 'stories'}` : ''}</span></div>
        {escribiendo
          ? <div className="aviso ig-aviso"><span className="cursor" />JARVIS está escribiendo el guion de {g.cantidad} stories con tu voz. Aparece aquí en cuanto lo guarde.</div>
          : (
            <>
              <textarea className="campo stories-guion" rows={14} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'## Story 1 · texto\nTexto en pantalla: …\nVisual: …\n\n## Story 2 · encuesta\nTexto en pantalla: …\nSticker: encuesta «Sí / No»'} />
              <div className="stories-guion-pie">
                {cambiado ? <><button type="button" className="btn btn-sec" onClick={guardar} disabled={Boolean(ocupado)}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar cambios'}</button><button type="button" className="link-btn" onClick={() => setTexto(g.guion)}>Deshacer</button></> : <span className="ayuda">{g.guion ? 'Puedes cambiarlo aquí a mano.' : 'Escríbelo aquí o pídeselo a JARVIS.'}</span>}
              </div>
            </>
          )}
        {g.error && !escribiendo && <div className="caja-error">{g.error}</div>}
        <div className="est-jarvis">
          <input className="campo" value={pedido} onChange={(e) => setPedido(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (pedido.trim() || !g.guion)) pedir(); }} placeholder={g.guion ? 'Pídele un cambio: «más corto», «añade un quiz en la 3», «cierra con SETTER»…' : 'Opcional: lo que quieres que tenga'} disabled={escribiendo} />
          <button type="button" className="btn btn-sec" onClick={pedir} disabled={escribiendo || Boolean(ocupado) || (Boolean(g.guion) && !pedido.trim())}><Icon name="sparkle" size={14} />{ocupado === 'jarvis' ? 'Enviando…' : g.guion ? 'Cambiar con JARVIS' : 'Escribir con JARVIS'}</button>
        </div>

        <div className="stories-paso"><span className="stories-n">2</span><b>Subir y programar</b><span className="t-dim">cuando las tengas hechas</span></div>
        <div className="stories-programar">
          <div>
            <b><Icon name="instagram" size={14} /> Publicar en Instagram</b>
            <small>Haz las stories con este guion, súbelas aquí en orden y elige el día y la hora: JARVIS las publica solas, una tras otra.</small>
            {hecho && <small className="t-ok">{hecho}</small>}
          </div>
          <button type="button" className="btn" onClick={() => setProgramando(true)} disabled={escribiendo}><Icon name="calendar" size={14} />Subir y programar</button>
        </div>
        {programando && <ProgramarStories ig={ig} titulo={g.titulo} onClose={() => setProgramando(false)} onHecho={(nn, conErrores) => { setHecho(`✓ ${nn} ${nn === 1 ? 'story programada' : 'stories programadas'}: las tienes en el calendario de Contenido.`); if (!conErrores) setProgramando(false); }} />}
        {aviso && <div className="caja-error">{aviso}</div>}
      </div>
    </div>
  );
}

export default function Stories({ piezas, ig, onAbrir }) {
  const [data, recargar, error] = useRecurso('/api/stories', null);
  const [sel, setSel] = useState(() => { try { return Number(localStorage.getItem('stories_sel')) || null; } catch { return null; } });
  const [nuevo, setNuevo] = useState(null); // { pieza } | {}
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [viendoEstilo, setViendoEstilo] = useState(false);
  const elegir = (id) => { setSel(id); try { localStorage.setItem('stories_sel', String(id || '')); } catch { /* sin localStorage */ } };
  // Desde la ficha de una pieza: «Guion de stories»
  useEffect(() => {
    const abrir = () => { if (piezaPendiente) { setNuevo({ pieza: piezaPendiente }); piezaPendiente = null; } };
    abrir();
    window.addEventListener('jarvis:stories-de', abrir);
    return () => window.removeEventListener('jarvis:stories-de', abrir);
  }, []);
  if (!data) return <div className="panel panel-pad vacio">{error ? `No se han podido cargar las stories: ${error}` : 'Cargando…'}</div>;
  const actual = data.guiones.find((g) => g.id === sel) || data.guiones[0] || null;
  return (
    <div className="stories-grid">
      <div className="panel panel-pad diseno-lista">
        <button type="button" className="btn stories-nuevo" onClick={() => setNuevo({})}><Icon name="plus" size={14} />Nuevo guion de stories</button>
        <button type="button" className="btn btn-sec stories-nuevo" style={{ marginTop: 8 }} onClick={() => setSubiendo(true)} title="Sube tus stories (fotos o vídeos) y prográmalas para que se publiquen solas en Instagram"><Icon name="calendar" size={14} />Subir y programar stories</button>
        {aviso && <div className="aviso ok" style={{ marginTop: 8 }}>{aviso}</div>}
        <button type="button" className={`stories-estilo${data.estilo?.texto.trim() || data.ejemplos?.length ? ' hecho' : ''}`} onClick={() => setViendoEstilo(true)} title="Tu CLAUDE.md y tus stories de ejemplo: JARVIS los sigue al escribir los guiones">
          <Icon name="doc" size={14} />
          <span><b>Tu estilo · CLAUDE.md y ejemplos</b><small>{[data.estilo?.texto.trim() && '✓ CLAUDE.md', data.ejemplos?.length && `✓ ${data.ejemplos.length} ${data.ejemplos.length === 1 ? 'ejemplo' : 'ejemplos'}`].filter(Boolean).join(' · ') || 'Añádelos para que replique tu estilo'}</small></span>
        </button>
        <div className="label" style={{ margin: '12px 0 8px' }}>Tus stories</div>
        {!data.guiones.length && <p className="ayuda">Aún no hay ninguna. Crea el guion de stories de un carrusel o un reel (o de un tema).</p>}
        {data.guiones.map((g) => (
          <button key={g.id} type="button" className={`diseno-item${actual?.id === g.id ? ' on' : ''}`} onClick={() => elegir(g.id)}>
            <span className="diseno-mini story"><Icon name="layers" size={14} /></span>
            <span className="diseno-item-txt">
              <b>{g.titulo}</b>
              <small>{g.pieza ? `De ${g.pieza.formato.toLowerCase()}` : g.tema ? 'De un tema' : 'A mano'} · {nStories(g.guion) || g.cantidad} stories</small>
              <small className={g.estado === 'error' ? 't-err' : ''}>{g.estado === 'escribiendo' ? 'JARVIS escribiendo el guion…' : g.estado === 'error' ? 'Con error' : g.guion ? 'Guion listo' : 'Sin guion'}</small>
            </span>
          </button>
        ))}
      </div>
      {actual
        ? <Detalle key={actual.id} g={actual} piezas={piezas} ig={ig} onAbrir={onAbrir} recargar={recargar} onBorrado={() => { elegir(null); recargar(); }} />
        : <div className="panel panel-pad diseno-vacio"><Icon name="layers" size={22} /><p>De cada carrusel o reel (o de un tema), JARVIS te escribe el guion de stories con tu estilo. Cuando las tengas hechas, las subes y las programas aquí.</p><button className="btn" onClick={() => setNuevo({})}><Icon name="plus" size={14} />Nuevo guion de stories</button></div>}
      {viendoEstilo && <EstiloStories estilo={data.estilo || { texto: '', ruta: 'Stories/CLAUDE.md', modificado: null }} ejemplos={data.ejemplos || []} onEjemplos={recargar} onClose={() => setViendoEstilo(false)} onGuardado={() => { setViendoEstilo(false); recargar(); }} />}
      {subiendo && <ProgramarStories ig={ig} titulo="Stories" onClose={() => setSubiendo(false)} onHecho={(n, conErrores) => { setAviso(`✓ ${n} ${n === 1 ? 'story programada' : 'stories programadas'}: las tienes en el calendario de Contenido.`); if (!conErrores) setSubiendo(false); }} />}
      {nuevo && <NuevoGuion data={data} piezas={piezas} inicial={nuevo.pieza || null} onClose={() => setNuevo(null)} onCreado={(g) => { setNuevo(null); elegir(g.id); recargar(); }} />}
    </div>
  );
}
