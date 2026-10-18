import { useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import ChatJarvis from '../../components/ChatJarvis.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { fechaCorta } from '../../lib/formato.js';
import { BotonCopiar } from '../contenido/comun.jsx';
import { Grupo, MiniLab, subirLab } from './comun.jsx';

// Imágenes con Higgsfield, en simple: qué quieres (y, si quieres, la foto a editar), formato y cuántas, y
// referencias. JARVIS decide si es imagen o vídeo, usa tu cara si sales tú y mira el coste antes de gastar.
const VACIO = { descripcion: '', editar: null, formato: '9:16', cantidad: 1, referencias: [] };
const resumenPregunta = (t) => (/^(Genera con Higgsfield|Quiero entrenar en Higgsfield|Quiero usar en JARVIS lo que YA tengo)/.test(t) ? t.split('\n').slice(0, 2).join('\n') : t);

// Miniatura de un archivo subido (imagen o vídeo)
const Miniatura = ({ ruta }) => <MiniLab ruta={ruta} />;

// Sube a imagenes/_referencias (las fotos a editar y las referencias van ahí)
async function subirReferencias(lista, setEstado) {
  const rutas = [];
  const fs = [...lista];
  for (let i = 0; i < fs.length; i++) {
    const n = fs.length > 1 ? `${i + 1} de ${fs.length}… ` : '';
    setEstado(`Subiendo ${n}`);
    const r = await subirLab(fs[i], { tipo: 'referencia' }, (p) => setEstado(`Subiendo ${n}${p}%`));
    rutas.push(r.ruta);
  }
  setEstado('');
  return rutas;
}

function Referencias({ archivos, seleccion, onSeleccion, recargar }) {
  const input = useRef(null);
  const [estado, setEstado] = useState('');
  const subir = async (lista) => {
    try { const rutas = await subirReferencias(lista, setEstado); onSeleccion((s) => [...s, ...rutas]); } catch (e) { setEstado(e.message); }
    recargar();
  };
  const borrar = async (a) => {
    if (!window.confirm(`¿Borrar «${a.nombre}»?`)) return;
    await api(`/api/laboratorio/archivo?ruta=${encodeURIComponent(a.ruta)}`, { method: 'DELETE' }).catch(() => {});
    onSeleccion((s) => s.filter((x) => x !== a.ruta));
    recargar();
  };
  return (
    <>
      <div className="img-subidas">
        {archivos.map((a) => (
          <div key={a.ruta} className={`img-mini${seleccion.includes(a.ruta) ? ' sel' : ''}`}>
            <button type="button" onClick={() => onSeleccion((s) => (s.includes(a.ruta) ? s.filter((x) => x !== a.ruta) : [...s, a.ruta]))} title="Usar como referencia">
              <Miniatura ruta={a.ruta} />
              {seleccion.includes(a.ruta) && <i><Icon name="check" size={11} /></i>}
            </button>
            <button type="button" className="img-mini-x" onClick={() => borrar(a)} aria-label={`Borrar ${a.nombre}`}>✕</button>
          </div>
        ))}
        <button type="button" className="img-mini img-mas" onClick={() => input.current?.click()}><Icon name="plus" size={16} /><small>Subir</small></button>
        <input ref={input} type="file" multiple accept="image/*,video/*" hidden onChange={(e) => { subir(e.target.files || []); e.target.value = ''; }} />
      </div>
      <small className="ayuda">{estado || 'Opcional: marca las que quieras usar (estilo, producto, encuadre…).'}</small>
    </>
  );
}

function FotoAEditar({ ruta, onCambio, recargar }) {
  const input = useRef(null);
  const [estado, setEstado] = useState('');
  const subir = async (f) => {
    if (!f) return;
    try { const [r] = await subirReferencias([f], setEstado); onCambio(r); } catch (e) { setEstado(e.message); }
    recargar();
  };
  return (
    <div className="img-editar">
      {ruta ? (
        <div className="img-mini sel">
          <button type="button" onClick={() => input.current?.click()} title="Cambiar la foto"><Miniatura ruta={ruta} /></button>
          <button type="button" className="img-mini-x" onClick={() => onCambio(null)} aria-label="Quitar la foto">✕</button>
        </div>
      ) : <button type="button" className="img-mini img-mas" onClick={() => input.current?.click()}><Icon name="plus" size={16} /><small>Foto</small></button>}
      <small className="ayuda">{estado || (ruta ? 'JARVIS parte de esta foto.' : 'Opcional: foto a editar o animar.')}</small>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

export default function Imagenes({ trabajando }) {
  const [fresco, setFresco] = useState(0);
  const [data, recargarBase, error] = useRecurso(`/api/laboratorio/imagenes${fresco ? `?fresco=1&n=${fresco}` : ''}`, null);
  const recargar = (forzar) => (forzar ? setFresco((n) => n + 1) : recargarBase());
  const [f, setF] = useState(VACIO);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);

  if (!data) return <div className="panel panel-pad vacio">{error ? `No se ha podido cargar: ${error}` : 'Cargando…'}</div>;
  const c = data.conector;
  const login = 'claude mcp login higgsfield --no-browser';
  const referencias = data.referencias.filter((a) => a.ruta !== f.editar);

  const empezar = async (e) => {
    e.preventDefault();
    setEnviando(true); setAviso(null);
    try {
      await api('/api/laboratorio/empezar', { method: 'POST', body: { tipo: 'imagen', datos: f } });
      setAviso({ tipo: 'ok', texto: 'JARVIS está preparando el prompt y mirando el coste. Si sale caro, te pregunta en el chat antes de gastar.' });
      setF((x) => ({ ...VACIO, formato: x.formato, cantidad: x.cantidad }));
      recargar();
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
    setEnviando(false);
  };
  const borrar = async (t) => {
    if (!window.confirm(`¿Borrar «${t.titulo}» y lo que tiene?`)) return;
    try { await api(`/api/laboratorio/imagenes/${t.nombre}`, { method: 'DELETE' }); recargar(); } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
  };

  return (
    <div className="lab-dos">
      <div className="lab-col">
        {!c.conectado && (
          <div className="aviso error img-desconectado">
            <span>Higgsfield no está conectado. En el VPS ejecuta <code>{login}</code> y pulsa Comprobar.</span>
            <BotonCopiar texto={login} className="chip" />
            <button type="button" className="chip" onClick={() => recargar(true)}>Comprobar</button>
          </div>
        )}

        <form className="panel panel-pad img-form" onSubmit={empezar}>
          <div className="panel-head"><span className="label">Crear con Higgsfield</span></div>

          <span className="label">Qué quieres y foto a editar</span>
          <div className="img-que">
            <textarea className="campo" rows={3} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} required
              placeholder="Yo entrenando a un cliente en un gimnasio, luz natural · Un escritorio con portátil y sitio libre arriba para el titular · Un B-roll de manos escribiendo" />
            <FotoAEditar ruta={f.editar} onCambio={(r) => setF((x) => ({ ...x, editar: r, referencias: x.referencias.filter((y) => y !== r) }))} recargar={recargar} />
          </div>

          <span className="label">Formato y cuántas</span>
          <div className="img-fila">
            <select className="campo" value={f.formato} onChange={(e) => setF({ ...f, formato: e.target.value })} aria-label="Formato">
              {Object.entries(data.formatos).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
            <select className="campo img-cuantas" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: Number(e.target.value) })} aria-label="Cuántas">
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <span className="label">Referencias{f.referencias.length ? ` (${f.referencias.length})` : ''}</span>
          <Referencias archivos={referencias} seleccion={f.referencias} onSeleccion={(fn) => setF((x) => ({ ...x, referencias: fn(x.referencias) }))} recargar={recargar} />

          {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
          <div className="modal-pie">
            <span />
            <button className="btn" disabled={!c.conectado || enviando || trabajando || !f.descripcion.trim()}><Icon name="sparkle" size={14} />Crear</button>
          </div>
        </form>

        {data.trabajos.map((t) => (
          <div key={t.nombre} className="panel panel-pad lab-resultado">
            <div className="panel-head">
              <div><h3>{t.titulo}</h3>{t.mod && <small className="t-dim">{fechaCorta(t.mod)}{t.formato ? ` · ${t.formato}` : ''}</small>}</div>
              <div className="lab-acciones"><button className="chip" onClick={() => borrar(t)} aria-label="Borrar"><Icon name="trash" /></button></div>
            </div>
            {t.archivos.length
              ? <Grupo g={{ id: t.nombre, nombre: t.videos ? 'Vídeos' : 'Imágenes', archivos: t.archivos }} titulo={t.titulo} formatoPorDefecto={() => (t.videos ? 'B-roll' : 'Post')} setAviso={setAviso} />
              : <div className="ayuda">{trabajando ? 'JARVIS lo está generando…' : 'Todavía sin resultados. Mira el chat de JARVIS.'}</div>}
          </div>
        ))}
      </div>
      <ChatJarvis
        conversacion="laboratorio"
        titulo="JARVIS · Laboratorio"
        subtitulo="Mira el coste antes de gastar créditos"
        placeholder="Pídele cambios: «más luz», «otra con plano cerrado»…"
        intro="Dime qué quieres y JARVIS lo crea con Higgsfield. Si sales tú, usa tu cara de Higgsfield. Si algo sale caro, te pregunta antes."
        mostrarPregunta={resumenPregunta}
        conGuardarGuion={false}
      />
    </div>
  );
}
