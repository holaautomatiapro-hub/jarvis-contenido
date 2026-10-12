import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';
import { Modal } from '../contenido/comun.jsx';

export const urlArchivo = (ruta) => `/api/laboratorio/archivo?ruta=${encodeURIComponent(ruta)}`;
export const esVideoRuta = (r) => /\.(mp4|mov|m4v|webm)$/i.test(r);
const mb = (b) => (b < 1024 ** 3 ? `${Math.max(1, Math.round(b / 1024 ** 2))} MB` : `${(b / 1024 ** 3).toLocaleString('es-ES', { maximumFractionDigits: 1 })} GB`);

// Sube un archivo al Laboratorio con su progreso (las entrevistas pesan mucho)
export function subirLab(file, { tipo, cliente = '' }, onProgreso = () => {}) {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/laboratorio/subir?tipo=${tipo}&nombre=${encodeURIComponent(file.name)}&cliente=${encodeURIComponent(cliente)}`);
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgreso(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let d = {};
      try { d = JSON.parse(x.responseText); } catch { /* sin cuerpo */ }
      if (x.status >= 200 && x.status < 300) ok(d); else ko(new Error(d.error || `No se pudo subir «${file.name}»`));
    };
    x.onerror = () => ko(new Error(`Se cortó la subida de «${file.name}». Revisa la conexión y vuelve a intentarlo.`));
    x.send(file);
  });
}

// Campo para elegir un archivo y subirlo (muestra el progreso y el resultado)
export function CampoArchivo({ etiqueta, ayuda, tipo, cliente, aceptar, valor, onSubido, deshabilitado }) {
  const input = useRef(null);
  const [pct, setPct] = useState(null);
  const [error, setError] = useState('');
  const elegir = async (f) => {
    if (!f) return;
    setError(''); setPct(0);
    try { const r = await subirLab(f, { tipo, cliente }, setPct); onSubido({ ...r, tamano: f.size }); }
    catch (e) { setError(e.message); }
    setPct(null);
  };
  return (
    <div className="lab-campo">
      <span className="label">{etiqueta}</span>
      <div className={`lab-archivo${valor ? ' ok' : ''}`}>
        <Icon name={valor ? 'check' : 'plus'} size={14} />
        <span className="lab-archivo-txt">{pct != null ? `Subiendo… ${pct}%` : valor ? `${valor.nombre}${valor.tamano ? ` · ${mb(valor.tamano)}` : ''}` : ayuda}</span>
        <button type="button" className="chip" onClick={() => input.current?.click()} disabled={pct != null || deshabilitado}>{valor ? 'Cambiar' : 'Elegir'}</button>
        <input ref={input} type="file" accept={aceptar} hidden onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {pct != null && <div className="bar lab-progreso"><span style={{ width: `${pct}%`, background: 'var(--accent-2)' }} /></div>}
      {error && <div className="aviso-error">{error}</div>}
    </div>
  );
}

// Lo que hace falta antes de empezar: el plugin (privado) y Python en el servidor
export function Preparar({ data, recargar }) {
  const zip = useRef(null);
  const [aviso, setAviso] = useState(null);
  const [req, setReq] = useState(null);
  const importar = async (f) => {
    if (!f) return;
    setAviso({ tipo: 'ok', texto: 'Importando el plugin…' });
    try {
      const r = await fetch('/api/laboratorio/plugin', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo importar');
      setAviso({ tipo: 'ok', texto: `Plugin importado (${d.plugin.skills.length} skills). Se guarda solo en tu servidor.` });
      recargar();
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
  };
  const comprobar = async () => { setReq('cargando'); try { setReq(await api('/api/laboratorio/requisitos')); } catch (e) { setReq({ lineas: [{ ok: false, texto: e.message }] }); } };
  const listo = data.plugin.instalado && data.python;
  return (
    <div className={`panel panel-pad lab-preparar${listo ? ' listo' : ''}`}>
      <div className="panel-head">
        <span className="label">Preparación</span>
        <button className="link-btn" onClick={comprobar}>Comprobar requisitos</button>
      </div>
      <div className="lab-checks">
        <div className={data.plugin.instalado ? 'ok' : ''}>
          <Icon name={data.plugin.instalado ? 'checkCircle' : 'clock'} size={15} />
          <span>{data.plugin.instalado ? <>Plugin <b>{data.plugin.nombre}</b> {data.plugin.version ? `v${data.plugin.version}` : ''}</> : 'Falta tu plugin de testimonios'}</span>
          <button className="chip" onClick={() => zip.current?.click()}>{data.plugin.instalado ? 'Actualizar (.zip)' : 'Importar (.zip)'}</button>
          <input ref={zip} type="file" accept=".zip" hidden onChange={(e) => { importar(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div className={data.python ? 'ok' : ''}>
          <Icon name={data.python ? 'checkCircle' : 'clock'} size={15} />
          <span>{data.python ? 'Python y sus librerías (transcribir, recortar fotos, montar)' : <>Falta Python en el servidor: en el VPS ejecuta <code>bash ~/instalar-vps.sh</code></>}</span>
        </div>
        <div className={data.marca.verificado ? 'ok' : ''}>
          <Icon name={data.marca.verificado ? 'checkCircle' : 'clock'} size={15} />
          <span>{data.marca.verificado ? <>Marca fijada: <b>{data.marca.nombre}</b> {data.marca.usuario}</> : 'Tu marca aún no está fijada: JARVIS te la pregunta la primera vez'}</span>
        </div>
      </div>
      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
      {req === 'cargando' && <div className="ayuda">Comprobando…</div>}
      {req && req !== 'cargando' && (
        <ul className="lab-requisitos">{req.lineas.map((l) => <li key={l.texto} className={l.ok ? 'ok' : ''}>{l.ok ? '✓' : '✗'} {l.texto}</li>)}</ul>
      )}
      <div className="ayuda">Carpeta de trabajo: <code>{data.carpeta}</code></div>
    </div>
  );
}

// Un archivo generado: vista previa, descargar, a la biblioteca
export function Medio({ a, onVer, seleccionado, onSeleccionar }) {
  return (
    <div className={`lab-medio${seleccionado ? ' sel' : ''}${a.enBiblioteca ? ' enviado' : ''}`}>
      {a.enBiblioteca && <span className="lab-enviado" title="Ya está en la biblioteca de Contenido">✓ En la biblioteca</span>}
      <button className="lab-medio-ver" onClick={() => onVer(a)} title="Ver">
        {esVideoRuta(a.ruta) ? <video src={`${urlArchivo(a.ruta)}#t=0.5`} preload="metadata" muted playsInline /> : <img src={urlArchivo(a.ruta)} alt="" loading="lazy" />}
      </button>
      <label className="lab-medio-pie">
        {onSeleccionar && <input type="checkbox" checked={seleccionado} onChange={() => onSeleccionar(a)} />}
        <span title={a.nombre}>{a.nombre.replace(/\.[^.]+$/, '')}</span>
      </label>
    </div>
  );
}

export function VerMedio({ a, onClose }) {
  return (
    <Modal titulo={a.nombre} onClose={onClose} ancho={720}>
      <div className="lab-ver">
        {esVideoRuta(a.ruta) ? <video src={urlArchivo(a.ruta)} controls autoPlay playsInline /> : <img src={urlArchivo(a.ruta)} alt="" />}
      </div>
      <div className="modal-pie">
        <a className="btn btn-sec" href={urlArchivo(a.ruta)} download={a.nombre}><Icon name="publish" size={14} />Descargar</a>
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

export function VerTexto({ ruta, titulo, onClose }) {
  const [t, setT] = useState(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => { api(`/api/laboratorio/texto?ruta=${encodeURIComponent(ruta)}`).then((r) => setT(r.texto)).catch((e) => setT(`No se pudo leer: ${e.message}`)); }, [ruta]);
  return (
    <Modal titulo={titulo} onClose={onClose} ancho={760}>
      <pre className="lab-texto">{t ?? 'Cargando…'}</pre>
      <div className="modal-pie">
        <button className="btn btn-sec" onClick={() => { navigator.clipboard?.writeText(t || ''); setCopiado(true); }}>{copiado ? '✓ Copiado' : 'Copiar todo'}</button>
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

// Pasa un grupo (o los elegidos) a la biblioteca. El carrusel en vídeo va junto (una pieza con todos sus vídeos);
// stories y clips, cada uno en su pieza. Lo que ya está en la biblioteca no se vuelve a mandar.
// Devuelve cuántas piezas nuevas se han creado.
export async function enviarGrupo(g, titulo, formatoPorDefecto, elegidos = []) {
  const juntos = g.id === 'carrusel-video';
  const rutas = elegidos.length ? elegidos : g.archivos.filter((a) => !a.enBiblioteca || juntos).map((a) => a.ruta);
  if (!rutas.length) return 0;
  const nombreDe = (r) => r.split('/').pop().replace(/\.[^.]+$/, '').replace(/^\d+-/, '').replace(/-/g, ' ');
  const envios = juntos ? [{ rutas, titulo: `${titulo} · ${g.nombre}` }] : rutas.map((r) => ({ rutas: [r], titulo: `${titulo} · ${nombreDe(r)}` }));
  let nuevas = 0;
  for (const e of envios) {
    const p = await api('/api/laboratorio/biblioteca', { method: 'POST', body: { ...e, formato: formatoPorDefecto(g) } });
    if (!p.yaEstaba) nuevas++;
  }
  return nuevas;
}
export const textoEnviadas = (n) => (n
  ? `${n} ${n === 1 ? 'pieza nueva' : 'piezas nuevas'} en Contenido → Biblioteca (fase Listo, con su caption y en la carpeta del trabajo): ponles día en el calendario.`
  : 'Ya estaba todo en la biblioteca: no se ha duplicado nada.');

// Grupo de archivos (stories, clips…) con selección para pasarlos a la biblioteca
export function Grupo({ g, titulo, formatoPorDefecto, setAviso }) {
  const [sel, setSel] = useState([]);
  const [viendo, setViendo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const alternar = (a) => setSel((s) => (s.includes(a.ruta) ? s.filter((x) => x !== a.ruta) : [...s, a.ruta]));
  const juntos = g.id === 'carrusel-video';
  const pendientes = g.archivos.filter((a) => !a.enBiblioteca).length;
  const aBiblioteca = async () => {
    setEnviando(true);
    try {
      setAviso({ tipo: 'ok', texto: textoEnviadas(await enviarGrupo(g, titulo, formatoPorDefecto, sel)) });
      setSel([]);
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
    setEnviando(false);
  };
  return (
    <div className="lab-grupo">
      <div className="lab-grupo-head">
        <b>{g.nombre}</b><span className="t-dim">{g.archivos.length}</span>
        <button className="chip" onClick={aBiblioteca} disabled={enviando || (!sel.length && !pendientes && !juntos)}><Icon name="book" />{enviando ? 'Pasando…' : sel.length ? `${sel.length} a la biblioteca` : !pendientes ? '✓ En la biblioteca' : juntos ? 'Todo a la biblioteca' : `${pendientes === g.archivos.length ? 'Todos' : `Los ${pendientes} que faltan`} a la biblioteca`}</button>
      </div>
      <div className="lab-medios">
        {g.archivos.map((a) => <Medio key={a.ruta} a={a} onVer={setViendo} seleccionado={sel.includes(a.ruta)} onSeleccionar={alternar} />)}
      </div>
      {viendo && <VerMedio a={viendo} onClose={() => setViendo(null)} />}
    </div>
  );
}
