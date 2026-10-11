import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';
import { diaLargo, hoyIso, sumarDias } from '../../lib/fechas.js';
import { ESTADOS, MAX_CAPTION, Miniatura, Modal, TIPOS, borrarArchivo, esMedio, esStory, esVideo, subirArchivo, tamanoLegible, tipoDe } from './comun.jsx';

// ---------- Visor a pantalla completa ----------
export function Visor({ archivos, inicio = 0, onClose }) {
  const [i, setI] = useState(inicio);
  const n = archivos.length;
  useEffect(() => {
    // En fase de captura: la ficha de debajo no recibe estas teclas
    const tecla = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) return;
      e.stopPropagation(); e.preventDefault();
      if (e.key === 'Escape') onClose();
      else setI((x) => (x + (e.key === 'ArrowRight' ? 1 : -1) + n) % n);
    };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  }, [n, onClose]);
  const a = archivos[i];
  if (!a) return null;
  return (
    <div className="visor" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="visor-barra">
        <span>{i + 1} / {n} · {a.nombre}</span>
        <a className="btn btn-sec" href={a.url} download={a.nombre}>Descargar</a>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      {n > 1 && <button className="visor-flecha izq" onClick={() => setI((i - 1 + n) % n)} aria-label="Anterior">‹</button>}
      {esVideo(a) ? <video key={a.url} src={a.url} controls autoPlay playsInline /> : <img src={a.url} alt={a.nombre} />}
      {n > 1 && <button className="visor-flecha der" onClick={() => setI((i + 1) % n)} aria-label="Siguiente">›</button>}
    </div>
  );
}

function Pildoras({ opciones, valor, onCambio, color }) {
  return (
    <div className="pildoras">
      {opciones.map((o) => (
        <button
          type="button" key={o.id}
          className={valor === o.id ? 'on' : ''}
          style={valor === o.id && color ? { '--c': o.color } : undefined}
          onClick={() => onCambio(o.id)}
        >
          {o.color && <span className="punto" style={{ background: o.color }} />}{o.label || o.id}
        </button>
      ))}
    </div>
  );
}

// ---------- Ficha de una pieza: nueva o para editar ----------
export function EditorContenido({ pieza, carpetas, onClose, onGuardado, onVisor }) {
  const nueva = !pieza.id;
  const [d, setD] = useState(() => ({
    titulo: pieza.titulo || '', carpeta: pieza.carpeta || '', formato: tipoDe(pieza.formato)?.id || pieza.formato || 'Reel',
    estado: pieza.estado || 'idea', fecha: pieza.fecha || '', hora: pieza.hora || '', caption: pieza.caption || '', video_url: pieza.video_url || '',
  }));
  const [archivos, setArchivos] = useState(pieza.archivos || []);
  const subidos = useRef(new Set()); // subidos en esta edición: si se cancela, se borran
  const [quitados, setQuitados] = useState([]); // ya guardados y quitados ahora: se borran al guardar
  const [subiendo, setSubiendo] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [sobre, setSobre] = useState(false);
  const input = useRef(null);
  const titulo = useRef(null);
  const ocupado = subiendo > 0 || guardando;
  const cambia = (k) => (e) => setD((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  useEffect(() => { if (nueva) titulo.current?.focus(); }, [nueva]);

  const cerrar = () => {
    if (ocupado) return;
    for (const a of archivos) if (subidos.current.has(a.path)) borrarArchivo(a);
    onClose();
  };

  // De uno en uno y en orden: no satura la conexión y conserva el orden del carrusel
  const subir = async (lista) => {
    const medios = [...lista].filter(esMedio);
    if (!medios.length) return setError('No había ninguna foto ni vídeo en lo que has elegido.');
    setError('');
    setSubiendo(medios.length);
    for (const f of medios) {
      try {
        const a = await subirArchivo(f);
        subidos.current.add(a.path);
        setArchivos((x) => [...x, a]);
      } catch (e) { setError((x) => (x ? `${x}\n` : '') + e.message); }
      setSubiendo((n) => n - 1);
    }
  };
  const quitar = (a) => {
    setArchivos((x) => x.filter((y) => y !== a));
    if (subidos.current.has(a.path)) { subidos.current.delete(a.path); borrarArchivo(a); }
    else setQuitados((x) => [...x, a]);
  };
  const moverArchivo = (i, dir) => setArchivos((x) => {
    const j = i + dir;
    if (j < 0 || j >= x.length) return x;
    const y = [...x];
    [y[i], y[j]] = [y[j], y[i]];
    return y;
  });

  const guardar = async (e) => {
    e?.preventDefault();
    if (ocupado) return;
    if (!d.titulo.trim()) return setError('Ponle un título.');
    setGuardando(true); setError('');
    const body = { ...d, carpeta: d.carpeta || null, fecha: d.fecha || null, hora: d.hora || null, archivos };
    try {
      if (nueva) await api('/api/piezas', { method: 'POST', body });
      else await api(`/api/piezas/${pieza.id}`, { method: 'PATCH', body });
      subidos.current.clear();
      for (const a of quitados) borrarArchivo(a);
      onGuardado(); onClose();
    } catch (err) { setError(err.message); setGuardando(false); }
  };
  const eliminar = async () => {
    if (!window.confirm(`¿Eliminar «${pieza.titulo}» y sus archivos?`)) return;
    try {
      for (const a of archivos) if (subidos.current.has(a.path)) borrarArchivo(a);
      await api(`/api/piezas/${pieza.id}`, { method: 'DELETE' });
      onGuardado(); onClose();
    } catch (err) { setError(err.message); }
  };

  const largo = d.caption.length > MAX_CAPTION;
  return (
    <Modal titulo={nueva ? 'Nuevo contenido' : 'Editar contenido'} onClose={cerrar} ancho={960} cerrarFuera={false} clase="editor-c">
      <form className="editor-grid" onSubmit={guardar}>
        <div className="editor-datos">
          <label className="campo-et">Título</label>
          <input ref={titulo} className="campo" value={d.titulo} onChange={cambia('titulo')} placeholder="3 errores al grabar un reel" maxLength={200} />
          {carpetas.length > 0 && (
            <>
              <label className="campo-et">Carpeta</label>
              <select className="campo" value={d.carpeta} onChange={cambia('carpeta')}>
                <option value="">Sin carpeta</option>
                {carpetas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
              </select>
            </>
          )}
          <label className="campo-et">Tipo</label>
          <Pildoras opciones={TIPOS} valor={d.formato} onCambio={cambia('formato')} />
          <label className="campo-et">Estado</label>
          <Pildoras opciones={ESTADOS} valor={d.estado} onCambio={cambia('estado')} color />
          <div className="dos-col">
            <div>
              <label className="campo-et">Fecha de publicación</label>
              <input type="date" className="campo" value={d.fecha} onChange={cambia('fecha')} />
            </div>
            <div>
              <label className="campo-et">Hora (opcional)</label>
              <input type="time" className="campo" value={d.hora} onChange={cambia('hora')} />
            </div>
          </div>
          {!d.fecha && <div className="ayuda">Sin fecha se queda en la biblioteca hasta que la programes.</div>}
          <label className="campo-et">Caption <span className={`contador${largo ? ' pasado' : ''}`}>{d.caption.length} / {MAX_CAPTION}</span></label>
          <textarea className="campo" rows={7} value={d.caption} onChange={cambia('caption')} placeholder="El texto que acompaña a la publicación…" />
          <label className="campo-et">URL del vídeo</label>
          <div className="fila" style={{ marginBottom: 0 }}>
            <input className="campo" value={d.video_url} onChange={cambia('video_url')} placeholder="https://drive.google.com/… o el enlace de la publicación" />
            {/^https?:\/\//i.test(d.video_url) && <a className="btn btn-sec" href={d.video_url} target="_blank" rel="noreferrer">↗ Abrir</a>}
          </div>
          <div className="aviso-publicar">
            <Icon name="publish" size={14} color="var(--accent-2)" />
            <span>JARVIS no publica por ti. Cuando esté lista, adapta el texto a cada red en <a href="#publicar" onClick={cerrar}>Publicar</a> y súbela tú.</span>
          </div>
        </div>

        <div className="editor-archivos">
          <label className="campo-et">Contenido (vídeos y fotos)</label>
          <div
            className={`soltar${sobre ? ' sobre' : ''}`}
            onClick={() => !ocupado && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
            onDragLeave={() => setSobre(false)}
            onDrop={(e) => { e.preventDefault(); setSobre(false); subir(e.dataTransfer.files); }}
            role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
          >
            <Icon name="share" size={18} />
            <span>{subiendo ? `Subiendo ${subiendo}…` : 'Arrastra aquí o pulsa para subir'}</span>
            <input ref={input} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { subir(e.target.files); e.target.value = ''; }} />
          </div>
          <div className="archivos-grid">
            {archivos.map((a, i) => (
              <div key={a.path || a.url} className="archivo" title={`${a.nombre} · ${tamanoLegible(a.tamano)}`}>
                <Miniatura p={{ archivos: [a] }} onClick={() => onVisor(archivos, i)} />
                <span className="archivo-n">{i + 1}</span>
                <div className="archivo-acciones">
                  <button type="button" onClick={() => moverArchivo(i, -1)} disabled={i === 0} aria-label="Mover antes">←</button>
                  <button type="button" onClick={() => moverArchivo(i, 1)} disabled={i === archivos.length - 1} aria-label="Mover después">→</button>
                  <button type="button" onClick={() => quitar(a)} aria-label="Quitar">✕</button>
                </div>
              </div>
            ))}
          </div>
          {!archivos.length && <div className="ayuda">Se guardan en tu PC, en la carpeta data\contenido de JARVIS.</div>}
        </div>
      </form>
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        {nueva ? <span /> : <button type="button" className="btn btn-sec peligro" onClick={eliminar} disabled={ocupado}>Eliminar</button>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sec" onClick={cerrar} disabled={ocupado}>Cancelar</button>
          <button type="button" className="btn" onClick={guardar} disabled={ocupado}>{guardando ? 'Guardando…' : subiendo ? 'Subiendo…' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Programar: elegir día (y hora) y pasarla al calendario ----------
export function ProgramarContenido({ pieza, fecha, onClose, onGuardado }) {
  const [d, setD] = useState({
    formato: tipoDe(pieza.formato)?.id || pieza.formato || 'Reel',
    fecha: fecha || pieza.fecha || sumarDias(hoyIso(), 1),
    hora: pieza.hora || '18:00',
    caption: pieza.caption || '',
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const story = esStory({ formato: d.formato });
  const n = pieza.archivos?.length || 0;

  const guardar = async () => {
    if (!d.fecha) return setError('Elige el día.');
    setGuardando(true);
    try {
      await api(`/api/piezas/${pieza.id}`, { method: 'PATCH', body: { formato: d.formato, fecha: d.fecha, hora: d.hora || null, ...(story ? {} : { caption: d.caption }) } });
      onGuardado(); onClose();
    } catch (e) { setError(e.message); setGuardando(false); }
  };

  return (
    <Modal titulo={<><Icon name="calendar" size={14} /> Programar</>} onClose={onClose} ancho={520}>
      <div className="programar-cab">
        <Miniatura p={pieza} className="peque" />
        <div><b>{pieza.titulo}</b><small>{n} archivo{n === 1 ? '' : 's'}</small></div>
      </div>
      <label className="campo-et">Tipo</label>
      <Pildoras opciones={TIPOS} valor={d.formato} onCambio={(v) => setD({ ...d, formato: v })} />
      <div className="dos-col">
        <div>
          <label className="campo-et">Día</label>
          <input type="date" className="campo" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} />
        </div>
        <div>
          <label className="campo-et">Hora</label>
          <input type="time" className="campo" value={d.hora} onChange={(e) => setD({ ...d, hora: e.target.value })} />
        </div>
      </div>
      {!story && (
        <>
          <label className="campo-et">Caption <span className={`contador${d.caption.length > MAX_CAPTION ? ' pasado' : ''}`}>{d.caption.length} / {MAX_CAPTION}</span></label>
          <textarea className="campo" rows={5} value={d.caption} onChange={(e) => setD({ ...d, caption: e.target.value })} placeholder="El texto que acompaña a la publicación…" />
        </>
      )}
      {d.fecha && <div className="aviso ok" style={{ marginTop: 10 }}>Quedará en el calendario el {diaLargo(d.fecha).toLowerCase()}{d.hora ? ` a las ${d.hora}` : ''}. La publicas tú.</div>}
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <span />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button className="btn" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Pasar al calendario'}</button>
        </div>
      </div>
    </Modal>
  );
}
