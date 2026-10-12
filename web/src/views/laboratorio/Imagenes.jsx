import { useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import ChatJarvis from '../../components/ChatJarvis.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { fechaCorta } from '../../lib/formato.js';
import { BotonCopiar } from '../contenido/comun.jsx';
import { Grupo, subirLab, urlArchivo, esVideoRuta } from './comun.jsx';

// Imágenes y vídeo con Higgsfield (tu cuenta, tus créditos): imágenes para tus diseños, fotos contigo,
// B-roll y animar una imagen. JARVIS mira el coste antes de generar y lo baja todo aquí.
const VACIO = { tipo: 'imagen', titulo: '', descripcion: '', formato: '9:16', cantidad: 2, duracion: 5, referencias: [], pieza: '', presupuesto: 60, indicaciones: '' };
const AYUDA_TIPO = {
  imagen: 'Fondos, objetos, escenas o portadas para tus carruseles y stories.',
  conmigo: 'Fotos tuyas en cualquier sitio, con tu personaje entrenado.',
  broll: 'Planos cortos para meter entre lo que dices en tus reels.',
  animar: 'Le da movimiento a una foto o a un diseño que subas.',
};
const resumenPregunta = (t) => (/^(Genera con Higgsfield|Quiero entrenar en Higgsfield)/.test(t) ? t.split('\n').slice(0, 2).join('\n') : t);

function Subidas({ etiqueta, ayuda, tipo, aceptar, archivos, seleccion, onSeleccion, recargar }) {
  const input = useRef(null);
  const [estado, setEstado] = useState('');
  const subir = async (lista) => {
    const fs = [...lista];
    for (let i = 0; i < fs.length; i++) {
      setEstado(`Subiendo ${i + 1} de ${fs.length}…`);
      try {
        const r = await subirLab(fs[i], { tipo }, (p) => setEstado(`Subiendo ${i + 1} de ${fs.length}… ${p}%`));
        if (onSeleccion) onSeleccion((s) => [...s, r.ruta]);
      } catch (e) { setEstado(e.message); recargar(); return; }
    }
    setEstado(''); recargar();
  };
  const borrar = async (a) => {
    if (!window.confirm(`¿Borrar «${a.nombre}»?`)) return;
    await api(`/api/laboratorio/archivo?ruta=${encodeURIComponent(a.ruta)}`, { method: 'DELETE' }).catch(() => {});
    if (onSeleccion) onSeleccion((s) => s.filter((x) => x !== a.ruta));
    recargar();
  };
  return (
    <div className="lab-campo lab-ancho">
      <span className="label">{etiqueta}</span>
      <div className="img-subidas">
        {archivos.map((a) => (
          <div key={a.ruta} className={`img-mini${seleccion?.includes(a.ruta) ? ' sel' : ''}`}>
            <button type="button" onClick={() => onSeleccion && onSeleccion((s) => (s.includes(a.ruta) ? s.filter((x) => x !== a.ruta) : [...s, a.ruta]))} title={onSeleccion ? 'Usar como referencia' : a.nombre}>
              {esVideoRuta(a.ruta) ? <video src={`${urlArchivo(a.ruta)}#t=0.3`} muted preload="metadata" /> : <img src={urlArchivo(a.ruta)} alt="" loading="lazy" />}
              {seleccion?.includes(a.ruta) && <i><Icon name="check" size={11} /></i>}
            </button>
            <button type="button" className="img-mini-x" onClick={() => borrar(a)} aria-label={`Borrar ${a.nombre}`}>✕</button>
          </div>
        ))}
        <button type="button" className="img-mini img-mas" onClick={() => input.current?.click()}><Icon name="plus" size={16} /><small>Subir</small></button>
        <input ref={input} type="file" multiple accept={aceptar} hidden onChange={(e) => { subir(e.target.files || []); e.target.value = ''; }} />
      </div>
      <small className="ayuda">{estado || ayuda}</small>
    </div>
  );
}

function Conector({ c, recargar }) {
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const anadir = async () => {
    setTrabajando(true); setError('');
    try { await api('/api/laboratorio/imagenes/conector', { method: 'POST' }); recargar(true); } catch (e) { setError(e.message); }
    setTrabajando(false);
  };
  const login = 'claude mcp login higgsfield --no-browser';
  return (
    <div className={`panel panel-pad lab-preparar${c.conectado ? ' listo' : ''}`}>
      <div className="panel-head">
        <span className="label">Higgsfield</span>
        <button className="link-btn" onClick={() => recargar(true)}>Comprobar</button>
      </div>
      <div className="lab-checks">
        <div className={c.conectado ? 'ok' : ''}>
          <Icon name={c.conectado ? 'checkCircle' : 'clock'} size={15} />
          <span>{c.conectado ? 'Conectado con tu cuenta: usa los créditos de tu plan' : c.estado === 'fallo' ? 'No se puede conectar con Higgsfield' : c.anadido ? 'El conector está añadido, falta iniciar sesión con tu cuenta' : 'Falta añadir el conector de Higgsfield'}</span>
          {!c.anadido && <button className="chip chip-acento" onClick={anadir} disabled={trabajando}>{trabajando ? 'Añadiendo…' : 'Añadir'}</button>}
        </div>
      </div>
      {c.anadido && !c.conectado && (
        <ol className="img-pasos">
          <li>Abre PowerShell en tu PC y entra al VPS: <code>ssh -t root@TU-IP</code></li>
          <li>Ejecuta <code>{login}</code> <BotonCopiar texto={login} className="chip" /></li>
          <li>Abre en tu navegador el enlace que sale, entra con tu cuenta de Higgsfield y acepta.</li>
          <li>El navegador acabará en una página que no carga (localhost): <b>copia esa dirección entera</b> y pégala en la terminal del VPS.</li>
          <li>Vuelve aquí y pulsa <b>Comprobar</b>.</li>
        </ol>
      )}
      {c.estado === 'fallo' && <div className="aviso error">Higgsfield no responde{c.detalle ? ` (${c.detalle})` : ''}. Si es la primera vez, inicia sesión con los pasos de arriba; si no, vuelve a comprobar en un rato.</div>}
      {error && <div className="aviso error">{error}</div>}
    </div>
  );
}

export default function Imagenes({ trabajando }) {
  const [fresco, setFresco] = useState(0);
  const [data, recargarBase, error] = useRecurso(`/api/laboratorio/imagenes${fresco ? `?fresco=1&n=${fresco}` : ''}`, null);
  const recargar = (forzar) => (forzar ? setFresco((n) => n + 1) : recargarBase());
  const [piezasData] = useRecurso('/api/piezas', []);
  const [f, setF] = useState(VACIO);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [nombreCara, setNombreCara] = useState('');
  const piezas = (Array.isArray(piezasData) ? piezasData : []).filter((p) => p.estado !== 'publicado').slice(0, 200);

  if (!data) return <div className="panel panel-pad vacio">{error ? `No se ha podido cargar: ${error}` : 'Cargando…'}</div>;
  const conectado = data.conector.conectado;
  const video = f.tipo === 'broll' || f.tipo === 'animar';

  const empezar = async (e) => {
    e.preventDefault();
    setEnviando(true); setAviso(null);
    try {
      await api('/api/laboratorio/empezar', { method: 'POST', body: { tipo: 'imagen', datos: f } });
      setAviso({ tipo: 'ok', texto: 'JARVIS está preparando el prompt y mirando el coste. Si pasa de tu presupuesto, te pregunta en el chat antes de gastar.' });
      setF((x) => ({ ...VACIO, tipo: x.tipo, formato: x.formato, presupuesto: x.presupuesto }));
      recargar();
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
    setEnviando(false);
  };
  const entrenar = async () => {
    setAviso(null);
    try {
      await api('/api/laboratorio/empezar', { method: 'POST', body: { tipo: 'cara', datos: { nombre: nombreCara } } });
      setAviso({ tipo: 'ok', texto: 'JARVIS está subiendo tus fotos y entrenando tu personaje (unos 10 minutos).' });
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
  };
  const borrar = async (t) => {
    if (!window.confirm(`¿Borrar «${t.titulo}» y lo que tiene?`)) return;
    try { await api(`/api/laboratorio/imagenes/${t.nombre}`, { method: 'DELETE' }); recargar(); } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
  };

  return (
    <div className="lab-dos">
      <div className="lab-col">
        <Conector c={data.conector} recargar={recargar} />

        <div className="panel panel-pad">
          <div className="panel-head">
            <span className="label">Tu cara</span>
            {data.personaje && <span className={`chip-est`} style={{ '--c': data.personaje.estado === 'listo' ? 'var(--green)' : 'var(--orange)' }}><i />{data.personaje.estado === 'listo' ? `Personaje «${data.personaje.nombre || 'Yo'}» listo` : 'Entrenando…'}</span>}
          </div>
          <p className="ayuda">{data.personaje ? 'Ya puedes pedir fotos contigo. Si quieres mejorarlo, sube más fotos y vuelve a entrenarlo.' : 'Sube de 5 a 20 fotos tuyas (mejor 10-20: solo tú, cara bien visible, luz y ángulos distintos). Higgsfield entrena tu personaje una vez y luego te saca en las fotos que pidas.'}</p>
          <Subidas etiqueta={`Tus fotos (${data.fotosCara.length})`} ayuda="Se guardan solo en tu servidor hasta que JARVIS las sube a Higgsfield para entrenar." tipo="cara" aceptar="image/*" archivos={data.fotosCara} recargar={recargar} />
          <div className="modal-pie">
            <input className="campo" style={{ maxWidth: 220 }} value={nombreCara} onChange={(e) => setNombreCara(e.target.value)} placeholder="Nombre del personaje (Yo)" maxLength={40} />
            <button className="btn btn-sec" onClick={entrenar} disabled={!conectado || trabajando || data.fotosCara.length < 5}><Icon name="users" size={14} />{data.personaje ? 'Volver a entrenar' : 'Crear mi personaje'}</button>
          </div>
        </div>

        <form className="panel panel-pad" onSubmit={empezar}>
          <div className="panel-head"><span className="label">Crear con Higgsfield</span></div>
          <div className="lab-plantillas img-tipos">
            {Object.entries(data.tipos).map(([id, nombre]) => (
              <button type="button" key={id} className={`lab-plantilla${f.tipo === id ? ' on' : ''}`} onClick={() => setF({ ...f, tipo: id, cantidad: id === 'broll' || id === 'animar' ? 1 : f.cantidad })} disabled={id === 'conmigo' && !data.personaje}>
                <span className="img-icono"><Icon name={{ imagen: 'eye', conmigo: 'users', broll: 'play', animar: 'sparkle' }[id]} size={16} /></span>
                <b>{nombre.split(' (')[0]}</b><small>{id === 'conmigo' && !data.personaje ? 'Primero crea tu personaje (arriba).' : AYUDA_TIPO[id]}</small>
              </button>
            ))}
          </div>
          <div className="lab-form" style={{ marginTop: 12 }}>
            <label className="lab-campo lab-ancho"><span className="label">Qué quieres</span>
              <textarea className="campo" rows={3} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} required
                placeholder={{ imagen: 'Un escritorio con portátil y café, luz de mañana, tonos fríos, sitio libre arriba para el titular', conmigo: 'Yo entrenando a un cliente en un gimnasio moderno, plano medio, luz natural', broll: 'Manos escribiendo en un portátil, plano cenital, movimiento lento', animar: 'Que la cámara se acerque despacio y se mueva el pelo con el aire' }[f.tipo]} />
            </label>
            <label className="lab-campo"><span className="label">Formato</span>
              <select className="campo" value={f.formato} onChange={(e) => setF({ ...f, formato: e.target.value })}>
                {Object.entries(data.formatos).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </label>
            <div className="lab-campo"><span className="label">{video ? 'Cuántos y duración' : 'Cuántas'}</span>
              <div className="lab-numeros" style={{ marginTop: 0 }}>
                <label><input className="campo" type="number" min={1} max={4} value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value })} aria-label="Cuántas" /></label>
                {video && <label><select className="campo" value={f.duracion} onChange={(e) => setF({ ...f, duracion: Number(e.target.value) })} aria-label="Duración">{[5, 8, 10].map((d) => <option key={d} value={d}>~{d} s</option>)}</select></label>}
              </div>
            </div>
            <Subidas etiqueta={`Referencias${f.referencias.length ? ` (${f.referencias.length} elegidas)` : ''}`} ayuda={f.tipo === 'animar' ? 'Sube y marca la imagen que quieres animar.' : 'Opcional: marca las imágenes que quieras usar de referencia (estilo, producto, encuadre…).'} tipo="referencia" aceptar="image/*,video/*" archivos={data.referencias} seleccion={f.referencias} onSeleccion={(fn) => setF((x) => ({ ...x, referencias: typeof fn === 'function' ? fn(x.referencias) : fn }))} recargar={recargar} />
            <label className="lab-campo"><span className="label">Para la pieza</span>
              <select className="campo" value={f.pieza} onChange={(e) => setF({ ...f, pieza: e.target.value })}>
                <option value="">Ninguna</option>
                {piezas.map((p) => <option key={p.id} value={p.id}>{p.titulo}</option>)}
              </select>
            </label>
            <label className="lab-campo"><span className="label">Presupuesto (créditos)</span>
              <input className="campo" type="number" min={1} max={2000} value={f.presupuesto} onChange={(e) => setF({ ...f, presupuesto: e.target.value })} />
            </label>
            <label className="lab-campo lab-ancho"><span className="label">Indicaciones (opcional)</span>
              <input className="campo" value={f.indicaciones} onChange={(e) => setF({ ...f, indicaciones: e.target.value })} placeholder="«Con los colores de mi marca», «estilo foto real, nada de ilustración»…" />
            </label>
          </div>
          {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
          <div className="modal-pie">
            <span className="ayuda">{conectado ? 'Si cuesta más que tu presupuesto, JARVIS te pregunta antes.' : 'Primero conecta Higgsfield (arriba).'}</span>
            <button className="btn" disabled={!conectado || enviando || trabajando || !f.descripcion.trim() || (f.tipo === 'animar' && !f.referencias.length)}><Icon name="sparkle" size={14} />Crear con JARVIS</button>
          </div>
        </form>

        {data.trabajos.map((t) => (
          <div key={t.nombre} className="panel panel-pad lab-resultado">
            <div className="panel-head">
              <div><span className="label">{data.tipos[t.tipo]?.split(' (')[0] || 'Higgsfield'}{t.formato ? ` · ${t.formato}` : ''}</span><h3>{t.titulo}</h3>{t.mod && <small className="t-dim">{fechaCorta(t.mod)}</small>}</div>
              <div className="lab-acciones"><button className="chip" onClick={() => borrar(t)} aria-label="Borrar"><Icon name="trash" /></button></div>
            </div>
            {t.archivos.length
              ? <Grupo g={{ id: t.nombre, nombre: t.videos ? 'Vídeos' : 'Imágenes', archivos: t.archivos }} titulo={t.titulo} formatoPorDefecto={() => (t.videos ? 'B-roll' : 'Post')} setAviso={setAviso} />
              : <div className="ayuda">{trabajando ? 'JARVIS lo está generando…' : 'Todavía sin resultados. Mira el chat de JARVIS.'}</div>}
          </div>
        ))}
        {!data.trabajos.length && <div className="panel panel-pad vacio">Aquí aparecerá lo que generes: lo pasas a la biblioteca con un clic y lo usas en tus diseños y reels.</div>}
      </div>
      <ChatJarvis
        conversacion="laboratorio"
        titulo="JARVIS · Laboratorio"
        subtitulo="Mira el coste antes de gastar créditos"
        placeholder="Pídele cambios: «más luz», «otra con plano cerrado»…"
        intro="JARVIS escribe el prompt, elige el modelo de Higgsfield, mira el coste y lo baja todo aquí. Si algo cuesta más que tu presupuesto, te pregunta antes."
        mostrarPregunta={resumenPregunta}
        conGuardarGuion={false}
      />
    </div>
  );
}
