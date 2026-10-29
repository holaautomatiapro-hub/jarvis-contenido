import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, normaliza } from '../../lib/api.js';
import { diaCorto } from '../../lib/fechas.js';

const PUBLICADOS = '__publicados';
import { Miniatura, Modal, OpcionesCarpetas, esMedio, esVideo, mimeDe, ordenNatural, subirArchivo, tamanoLegible, textoTipo, tituloDeArchivo } from './comun.jsx';

// Lee lo que se suelta: archivos sueltos y carpetas enteras (con subcarpetas)
async function leerSoltado(dt) {
  const entradas = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entradas.length) return { sueltos: [...dt.files], carpetas: [] };
  const archivo = (e) => new Promise((ok) => e.file(ok, () => ok(null)));
  const todo = async (dir) => {
    const lector = dir.createReader();
    const out = [];
    // readEntries devuelve los ficheros por tandas: hay que llamar hasta que venga vacío
    for (;;) {
      const tanda = await new Promise((ok) => lector.readEntries(ok, () => ok([])));
      if (!tanda.length) break;
      for (const e of tanda) {
        if (e.isFile) { const f = await archivo(e); if (f) out.push(f); } else if (e.isDirectory) out.push(...(await todo(e)));
      }
    }
    return out;
  };
  const sueltos = [], carpetas = [];
  for (const e of entradas) {
    if (e.isFile) { const f = await archivo(e); if (f) sueltos.push(f); } else if (e.isDirectory) carpetas.push({ nombre: e.name, archivos: await todo(e) });
  }
  return { sueltos, carpetas };
}
// Input con webkitdirectory: se agrupa por la carpeta de arriba
const carpetasDeInput = (files) => {
  const m = new Map();
  for (const f of files) {
    const nombre = (f.webkitRelativePath || '').split('/')[0] || 'Carpeta';
    m.set(nombre, [...(m.get(nombre) || []), f]);
  }
  return [...m].map(([nombre, archivos]) => ({ nombre, archivos }));
};

const rutaLegible = (n) => String(n || '').split('/').join(' › ');

// ---------- Ventana para revisar una carpeta antes de subirla ----------
function MiniLocal({ f }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const u = URL.createObjectURL(f); setUrl(u); return () => URL.revokeObjectURL(u); }, [f]);
  if (!url) return <div className="miniatura-c mini-local" />;
  return <div className="miniatura-c mini-local">{/^video\//.test(mimeDe(f)) ? <video src={`${url}#t=0.1`} preload="metadata" muted /> : <img src={url} alt="" />}</div>;
}

function VentanaCarpeta({ carpeta, quedan, carpetas, dentro = null, extra = { estado: 'editar' }, conCarpetas = true, onCancelar, onSaltar, onHecho }) {
  const propuesta = dentro ? `${dentro}/${carpeta.nombre}` : carpeta.nombre;
  const [lista, setLista] = useState(() => carpeta.archivos.filter(esMedio).sort((a, b) => ordenNatural(a.name, b.name)));
  const puedeCarrusel = lista.length >= 2 && lista.length <= 10;
  const [modo, setModo] = useState(puedeCarrusel ? 'carrusel' : 'separado');
  const [titulo, setTitulo] = useState(carpeta.nombre);
  const [destino, setDestino] = useState(propuesta);
  const [progreso, setProgreso] = useState(null);
  const [error, setError] = useState('');
  const arrastrado = useRef(null);
  useEffect(() => { if (modo === 'carrusel' && !puedeCarrusel) setModo('separado'); }, [modo, puedeCarrusel]);

  const mover = (i, j) => setLista((l) => { if (j < 0 || j >= l.length) return l; const x = [...l]; const [f] = x.splice(i, 1); x.splice(j, 0, f); return x; });
  const existe = carpetas.some((c) => c.nombre === propuesta);

  const guardar = async () => {
    if (!lista.length) return setError('No queda ningún archivo.');
    if (modo === 'carrusel' && !puedeCarrusel) return setError('Un carrusel lleva entre 2 y 10 archivos.');
    setError('');
    if (conCarpetas && destino && !carpetas.some((c) => c.nombre === destino)) await api('/api/contenido/carpetas', { method: 'POST', body: { nombre: destino } }).catch(() => {});
    const subidos = [];
    try {
      for (let i = 0; i < lista.length; i++) {
        setProgreso(`Subiendo ${i + 1} de ${lista.length}…`);
        subidos.push(await subirArchivo(lista[i]));
      }
      const comun = { ...extra, carpeta: conCarpetas ? destino || null : null };
      if (modo === 'carrusel') await api('/api/piezas', { method: 'POST', body: { ...comun, titulo: titulo.trim() || carpeta.nombre, formato: 'Carrusel', archivos: subidos } });
      else {
        for (const a of subidos) {
          await api('/api/piezas', { method: 'POST', body: { ...comun, titulo: tituloDeArchivo(a.nombre), formato: modo === 'stories' ? 'Story' : esVideo(a) ? 'Reel' : 'Post', archivos: [a] } });
        }
      }
      onHecho();
    } catch (e) { setError(e.message); setProgreso(null); }
  };

  const textoBoton = modo === 'carrusel' ? 'Guardar carrusel' : modo === 'stories' ? `Guardar ${lista.length} stories` : `Guardar ${lista.length} piezas`;
  return (
    <Modal titulo={`Carpeta «${carpeta.nombre}»`} onClose={onCancelar} ancho={640} cerrarFuera={false}>
      <div className="ayuda" style={{ marginTop: -6, marginBottom: 10 }}>
        {lista.length} archivo{lista.length === 1 ? '' : 's'} · arrástralos para cambiar el orden{quedan ? ` · después quedan ${quedan} carpeta${quedan === 1 ? '' : 's'} más` : ''}
      </div>
      <div className="carpeta-lista">
        {lista.map((f, i) => (
          <div
            key={`${f.name}-${f.size}-${f.lastModified}`} className="carpeta-fila" draggable
            onDragStart={() => { arrastrado.current = i; }}
            onDragOver={(e) => { e.preventDefault(); if (arrastrado.current !== null && arrastrado.current !== i) { mover(arrastrado.current, i); arrastrado.current = i; } }}
            onDragEnd={() => { arrastrado.current = null; }}
          >
            <span className="asa">⋮⋮</span>
            <span className="carpeta-n">{i + 1}</span>
            <MiniLocal f={f} />
            <div className="fila-c-txt"><b>{f.name}</b><small>{tamanoLegible(f.size)}</small></div>
            <button className="icon-btn" onClick={() => mover(i, i - 1)} disabled={i === 0} aria-label="Subir">▲</button>
            <button className="icon-btn" onClick={() => mover(i, i + 1)} disabled={i === lista.length - 1} aria-label="Bajar">▼</button>
            <button className="icon-btn" onClick={() => setLista((l) => l.filter((x) => x !== f))} aria-label="No subir este archivo" title="No subir este archivo">✕</button>
          </div>
        ))}
      </div>
      <div className="modos">
        {[
          { id: 'carrusel', t: 'Carrusel', d: 'Una sola pieza, en este orden', off: !puedeCarrusel },
          { id: 'stories', t: 'Stories', d: 'Una story por archivo, en este orden' },
          { id: 'separado', t: 'Por separado', d: 'Cada archivo, un post o un reel' },
        ].map((m) => (
          <button key={m.id} className={`modo${modo === m.id ? ' on' : ''}`} disabled={m.off} onClick={() => setModo(m.id)} title={m.off ? 'Un carrusel lleva entre 2 y 10 archivos' : undefined}>
            <b>{m.t}</b><small>{m.d}</small>
          </button>
        ))}
      </div>
      <div className="dos-col">
        {modo === 'carrusel' && (
          <div>
            <label className="campo-et">Título del carrusel</label>
            <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
        )}
        {conCarpetas && <div>
          <label className="campo-et">Guardar en la carpeta</label>
          <select className="campo" value={destino} onChange={(e) => setDestino(e.target.value)}>
            {!existe && <option value={propuesta}>{rutaLegible(propuesta)} (nueva)</option>}
            <OpcionesCarpetas carpetas={carpetas} />
            <option value="">Sin carpeta</option>
          </select>
        </div>}
      </div>
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        {quedan ? <button className="link-btn" onClick={onSaltar} disabled={Boolean(progreso)}>Saltar esta carpeta</button> : <span />}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sec" onClick={onCancelar} disabled={Boolean(progreso)}>Cancelar</button>
          <button className="btn" onClick={guardar} disabled={Boolean(progreso)}>{progreso || textoBoton}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Biblioteca: lo que aún no tiene día ----------
// deposito: la misma vista para el Depósito (publicaciones terminadas en reserva, sin carpetas): lo que se sube
// entra listo y en el depósito, y «Programar» le pone día y hora.
export function Biblioteca({ piezas, publicados = [], carpetas, onAbrir, onProgramar, onRepublicar, onNuevo, recargar, deposito = false }) {
  const extra = deposito ? { estado: 'listo', deposito: true } : { estado: 'editar' };
  const [abierta, setAbierta] = useState(null); // null = todas · '' = sin carpeta · nombre
  const [busca, setBusca] = useState('');
  const [marcadas, setMarcadas] = useState([]); // en el orden en que se marcan (= orden del carrusel)
  const [cola, setCola] = useState([]);
  const [estado, setEstado] = useState(null); // 'leyendo' | 'Subiendo i de N…'
  const [errores, setErrores] = useState([]);
  const [sobre, setSobre] = useState(false);
  const [nueva, setNueva] = useState(null);
  const [renombrando, setRenombrando] = useState(null);
  const inputArchivos = useRef(null);
  const inputCarpeta = useRef(null);

  const lista = useMemo(() => {
    const b = normaliza(busca.trim());
    // «Publicados»: lo que ya salió (aunque tenga fecha), para volver a subirlo otro día
    if (abierta === PUBLICADOS) {
      return publicados.filter((p) => !b || normaliza(`${p.titulo}\n${p.caption || ''}`).includes(b))
        .sort((a, b2) => String(b2.ig_publicado_en || b2.fecha || '').localeCompare(String(a.ig_publicado_en || a.fecha || '')) || b2.id - a.id);
    }
    return piezas
      .filter((p) => abierta === null || (abierta === '' ? !p.carpeta : p.carpeta === abierta))
      .filter((p) => !b || normaliza(`${p.titulo}\n${p.caption || ''}`).includes(b))
      .sort((a, b2) => b2.id - a.id);
  }, [piezas, publicados, abierta, busca]);
  const verPublicados = abierta === PUBLICADOS;
  // La carpeta abierta de verdad («Publicados» es una vista, no una carpeta)
  const carpeta = verPublicados ? null : abierta;
  const sinCarpeta = piezas.filter((p) => !p.carpeta).length;
  const enCarpeta = (n) => piezas.filter((p) => p.carpeta === n).length;
  // Con subcarpetas: lo que hay dentro, contando las de dentro
  const enArbol = (n) => piezas.filter((p) => p.carpeta === n || String(p.carpeta || '').startsWith(`${n}/`)).length;
  const raices = carpetas.filter((c) => !c.padre);
  const subcarpetas = carpeta ? carpetas.filter((c) => c.padre === carpeta) : [];
  const migas = carpeta ? carpeta.split('/').map((_, i, l) => l.slice(0, i + 1).join('/')) : [];

  const subirSueltos = async (files) => {
    const medios = files.filter(esMedio);
    const errs = [];
    for (let i = 0; i < medios.length; i++) {
      setEstado(`Subiendo ${i + 1} de ${medios.length}…`);
      try {
        const a = await subirArchivo(medios[i]);
        await api('/api/piezas', { method: 'POST', body: { ...extra, titulo: tituloDeArchivo(a.nombre), formato: esVideo(a) ? 'Reel' : 'Post', carpeta: carpeta || null, archivos: [a] } });
      } catch (e) { errs.push(e.message); }
    }
    setEstado(null);
    setErrores(errs);
    recargar();
  };
  const recibir = async ({ sueltos, carpetas: cs }) => {
    const medios = sueltos.filter(esMedio);
    const conMedios = cs.filter((c) => c.archivos.some(esMedio));
    if (!medios.length && !conMedios.length) return setErrores(['No había ninguna foto ni vídeo en lo que has elegido.']);
    setErrores([]);
    if (medios.length) await subirSueltos(medios);
    if (conMedios.length) setCola((c) => [...c, ...conMedios]);
  };
  const soltar = async (e) => {
    e.preventDefault();
    setSobre(false);
    setEstado('leyendo');
    const r = await leerSoltado(e.dataTransfer);
    setEstado(null);
    recibir(r);
  };

  const accion = async (fn, error) => {
    try { await fn(); setMarcadas([]); recargar(); } catch (e) { setErrores([e.message || error]); }
  };
  const juntar = () => accion(() => api('/api/contenido/juntar', { method: 'POST', body: { ids: marcadas } }), 'No se pudieron juntar.');
  const moverA = (c) => accion(() => api('/api/contenido/mover', { method: 'POST', body: { ids: marcadas, carpeta: c || null } }), 'No se pudieron mover.');
  const alDeposito = (v) => accion(async () => { for (const id of marcadas) await api(`/api/piezas/${id}`, { method: 'PATCH', body: v ? { deposito: true, estado: 'listo' } : { deposito: false } }); }, 'No se pudieron mover.');
  const eliminar = () => {
    if (!window.confirm(`¿Eliminar ${marcadas.length} pieza${marcadas.length === 1 ? '' : 's'} y sus archivos?`)) return;
    accion(() => api('/api/contenido/borrar', { method: 'POST', body: { ids: marcadas } }), 'No se pudieron eliminar.');
  };
  const [nuevaSub, setNuevaSub] = useState(null);
  const crearCarpeta = async () => {
    try { const r = await api('/api/contenido/carpetas', { method: 'POST', body: { nombre: nueva } }); setNueva(null); setAbierta(r.nombre); recargar(); }
    catch (e) { setErrores([e.message]); }
  };
  const crearSubcarpeta = async () => {
    try { const r = await api('/api/contenido/carpetas', { method: 'POST', body: { nombre: nuevaSub, padre: carpeta } }); setNuevaSub(null); setAbierta(r.nombre); recargar(); }
    catch (e) { setErrores([e.message]); }
  };
  const renombrar = async () => {
    // Se cambia solo el nombre de esta carpeta: sigue dentro de la misma
    const padre = abierta.includes('/') ? abierta.slice(0, abierta.lastIndexOf('/')) : '';
    const nuevoNombre = renombrando.replace(/\//g, '-');
    try { const r = await api('/api/contenido/carpetas', { method: 'PATCH', body: { de: abierta, a: padre ? `${padre}/${nuevoNombre}` : nuevoNombre } }); setRenombrando(null); setAbierta(r.nombre); recargar(); }
    catch (e) { setErrores([e.message]); }
  };
  const borrarCarpeta = async () => {
    const n = enArbol(abierta);
    const subs = carpetas.filter((c) => c.nombre.startsWith(`${abierta}/`)).length;
    const padre = abierta.includes('/') ? abierta.slice(0, abierta.lastIndexOf('/')) : null;
    const nombre = abierta.split('/').at(-1);
    if (!window.confirm(`¿Eliminar la carpeta «${nombre}»${subs ? ` y sus ${subs} subcarpeta${subs === 1 ? '' : 's'}` : ''}? Sus ${n} pieza${n === 1 ? '' : 's'} no se borran: ${padre ? `pasan a «${padre.split('/').at(-1)}»` : 'se quedan sin carpeta'}.`)) return;
    try { await api(`/api/contenido/carpetas?nombre=${encodeURIComponent(abierta)}`, { method: 'DELETE' }); setAbierta(padre); recargar(); }
    catch (e) { setErrores([e.message]); }
  };
  const marcar = (id) => setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const teclas = (fn, cancelar) => (e) => { if (e.key === 'Enter') fn(); if (e.key === 'Escape') cancelar(); };

  return (
    <div className="panel panel-pad biblioteca">
      <div
        className={`subida${sobre ? ' sobre' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={soltar}
      >
        {estado === 'leyendo' ? <span className="subida-txt">Leyendo las carpetas…</span>
          : estado ? <span className="subida-txt">{estado}</span>
            : (
              <>
                <Icon name="share" size={22} color="var(--accent-2)" />
                <b>{deposito ? 'Arrastra aquí las publicaciones que quieres guardar en reserva' : 'Arrastra aquí tus vídeos y fotos, o carpetas enteras'}</b>
                <span className="ayuda">{deposito ? 'Cada foto o vídeo suelto, una publicación. Una carpeta, un carrusel (podrás ordenarlo). Cuando quieras sacarla, pulsa «Programar» y elige día y hora.' : carpeta ? `Lo que subas suelto irá a la carpeta «${rutaLegible(carpeta)}».` : 'Con una carpeta podrás ordenar sus archivos y elegir si es un carrusel o stories.'}</span>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {deposito && onNuevo && <button className="btn" onClick={onNuevo} title="Con sus archivos, el caption y el tipo"><Icon name="plus" size={13} />Nueva publicación</button>}
                  <button className="btn btn-sec" onClick={() => inputArchivos.current?.click()}>Elegir archivos</button>
                  <button className="btn btn-sec" onClick={() => inputCarpeta.current?.click()}>Añadir una carpeta</button>
                </div>
              </>
            )}
        <input ref={inputArchivos} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { recibir({ sueltos: [...e.target.files], carpetas: [] }); e.target.value = ''; }} />
        <input ref={inputCarpeta} type="file" multiple hidden webkitdirectory="" directory="" onChange={(e) => { recibir({ sueltos: [], carpetas: carpetasDeInput([...e.target.files]) }); e.target.value = ''; }} />
      </div>
      {errores.length > 0 && <div className="caja-error">{errores.join('\n')}</div>}

      {!deposito && <div className="carpetas-chips">
        <button className={`chip${abierta === null ? ' on' : ''}`} onClick={() => setAbierta(null)}>Todas <span className="cuenta">{piezas.length}</span></button>
        {publicados.length > 0 && <button className={`chip chip-publicados${verPublicados ? ' on' : ''}`} onClick={() => { setAbierta(PUBLICADOS); setMarcadas([]); }} title="Lo que ya publicaste, para volver a subirlo otro día"><Icon name="checkCircle" />Publicados <span className="cuenta">{publicados.length}</span></button>}
        {carpetas.length > 0 && <button className={`chip${abierta === '' ? ' on' : ''}`} onClick={() => setAbierta('')}>Sin carpeta <span className="cuenta">{sinCarpeta}</span></button>}
        {raices.map((c) => (
          <button key={c.nombre} className={`chip${carpeta && (carpeta === c.nombre || carpeta.startsWith(`${c.nombre}/`)) ? ' on' : ''}`} onClick={() => setAbierta(c.nombre)}><Icon name="folder" />{c.nombre} <span className="cuenta">{enArbol(c.nombre)}</span></button>
        ))}
        {nueva === null ? <button className="chip discontinuo" onClick={() => setNueva('')}><Icon name="plus" />Nueva carpeta</button> : (
          <span className="en-linea">
            <input autoFocus className="campo" placeholder="Nombre de la carpeta" value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={teclas(crearCarpeta, () => setNueva(null))} />
            <button className="btn btn-sec" onClick={crearCarpeta}>Crear</button>
            <button className="link-btn" onClick={() => setNueva(null)}>Cancelar</button>
          </span>
        )}
      </div>}

      {carpeta && (
        <>
        <div className="carpeta-abierta">
          {renombrando === null ? (
            <>
              <nav className="carpeta-migas" aria-label="Carpeta">
                <Icon name="folder" size={14} />
                {migas.map((m, i) => (i === migas.length - 1
                  ? <b key={m}>{m.split('/').at(-1)}</b>
                  : <span key={m}><button className="link-btn" onClick={() => setAbierta(m)}>{m.split('/').at(-1)}</button><i>›</i></span>))}
              </nav>
              <button className="link-btn" onClick={() => setRenombrando(abierta.split('/').at(-1))}>✎ Renombrar</button>
              <button className="link-btn peligro" onClick={borrarCarpeta}>Eliminar carpeta</button>
            </>
          ) : (
            <span className="en-linea">
              <input autoFocus className="campo" value={renombrando} onChange={(e) => setRenombrando(e.target.value)} onKeyDown={teclas(renombrar, () => setRenombrando(null))} />
              <button className="btn btn-sec" onClick={renombrar}>Guardar</button>
              <button className="link-btn" onClick={() => setRenombrando(null)}>Cancelar</button>
            </span>
          )}
        </div>
        <div className="carpetas-chips subcarpetas">
          {subcarpetas.map((c) => (
            <button key={c.nombre} className="chip" onClick={() => setAbierta(c.nombre)}><Icon name="folder" />{c.etiqueta} <span className="cuenta">{enArbol(c.nombre)}</span></button>
          ))}
          {nuevaSub === null ? <button className="chip discontinuo" onClick={() => setNuevaSub('')}><Icon name="plus" />Subcarpeta</button> : (
            <span className="en-linea">
              <input autoFocus className="campo" placeholder={`Subcarpeta dentro de «${carpeta.split('/').at(-1)}»`} value={nuevaSub} onChange={(e) => setNuevaSub(e.target.value)} onKeyDown={teclas(crearSubcarpeta, () => setNuevaSub(null))} />
              <button className="btn btn-sec" onClick={crearSubcarpeta}>Crear</button>
              <button className="link-btn" onClick={() => setNuevaSub(null)}>Cancelar</button>
            </span>
          )}
        </div>
        </>
      )}

      <div className="bib-barra">
        {marcadas.length ? (
          <>
            <b>{marcadas.length} marcada{marcadas.length === 1 ? '' : 's'}</b>
            <button className="btn btn-sec" disabled={marcadas.length < 2} onClick={juntar} title="En el orden en que las has marcado"><Icon name="layers" size={13} />Juntar en un carrusel</button>
            {deposito ? <button className="btn btn-sec" onClick={() => alDeposito(false)} title="Vuelven a la Biblioteca"><Icon name="book" size={13} />Sacar del depósito</button> : (
              <>
                <select className="campo" value="-" onChange={(e) => moverA(e.target.value === '__sin' ? '' : e.target.value)} style={{ width: 180 }} aria-label="Mover a carpeta">
                  <option value="-" disabled>Mover a carpeta…</option>
                  <OpcionesCarpetas carpetas={carpetas} />
                  <option value="__sin">Sin carpeta</option>
                </select>
                <button className="btn btn-sec" onClick={() => alDeposito(true)} title="Publicaciones terminadas que guardas en reserva"><Icon name="box" size={13} />Al depósito</button>
              </>
            )}
            <button className="btn btn-sec peligro" onClick={eliminar}>Eliminar</button>
            <button className="link-btn" onClick={() => setMarcadas([])}>Desmarcar</button>
          </>
        ) : (
          <>
            <div className="buscar-mini"><Icon name="search" size={13} /><input placeholder={deposito ? 'Buscar en el depósito' : 'Buscar en la biblioteca'} value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
            <span className="ayuda" style={{ marginLeft: 'auto' }}>{verPublicados ? `${publicados.length} ya publicados · «Volver a publicar» hace una copia con los mismos archivos` : deposito ? `${piezas.length} en reserva` : `${piezas.length} sin programar`}</span>
          </>
        )}
      </div>

      <div className="bib-grid">
        {lista.map((p) => {
          const n = marcadas.indexOf(p.id);
          return (
            <div key={p.id} className={`bib-card${n >= 0 ? ' marcada' : ''}`}>
              <Miniatura p={p} className="bib-img" onClick={() => onAbrir(p)} />
              {!p.archivos.length && <span className="bib-sin" onClick={() => onAbrir(p)}>Sin archivo</span>}
              {!verPublicados && <button className="bib-check" onClick={() => marcar(p.id)} aria-label={n >= 0 ? 'Desmarcar' : 'Marcar'}>{n >= 0 ? (marcadas.length > 1 ? n + 1 : '✓') : ''}</button>}
              <span className="bib-tipo">{textoTipo(p.formato)}</span>
              {p.archivos.length > 1 && <span className="bib-n">🎞 {p.archivos.length}</span>}
              <div className="bib-pie">
                {verPublicados ? (
                  <>
                    <div className="fila-c-txt"><b>{p.titulo}</b><small>Publicado {p.ig_publicado_en ? `el ${diaCorto(p.ig_publicado_en.slice(0, 10))}` : p.fecha ? `el ${diaCorto(p.fecha)}` : ''}{p.ig_permalink && <> · <a href={p.ig_permalink} target="_blank" rel="noreferrer">verlo ↗</a></>}</small></div>
                    <button className="btn btn-sec bib-prog" onClick={() => onRepublicar(p)} title="Hace una copia con los mismos archivos y caption, y eliges el día"><Icon name="refresh" size={12} />Volver a publicar</button>
                  </>
                ) : (
                  <>
                    <div className="fila-c-txt"><b>{p.titulo}</b>{deposito ? <small>{p.formato === 'Story' ? 'Story' : p.caption?.trim() ? p.caption.trim().slice(0, 60) : '⚠ Sin caption'}</small> : p.carpeta && p.carpeta !== abierta && <small><Icon name="folder" size={10} /> {p.carpeta}</small>}</div>
                    <button className="btn btn-sec bib-prog" onClick={() => onProgramar(p)} title={deposito ? 'Elegir día y hora: sale del depósito y pasa al calendario' : 'Elegir día y pasarla al calendario'}><Icon name="calendar" size={12} />Programar</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!lista.length && <div className="vacio">{verPublicados ? 'Nada coincide con la búsqueda.' : piezas.length ? (carpeta && subcarpetas.length && !busca ? 'Esta carpeta solo tiene subcarpetas: ábrelas arriba.' : 'Nada coincide con la búsqueda o la carpeta.') : deposito ? 'El depósito está vacío. Sube arriba las publicaciones que quieras tener en reserva.' : 'La biblioteca está vacía. Arrastra arriba tu contenido.'}</div>}

      {cola.length > 0 && (
        <VentanaCarpeta
          key={`${cola[0].nombre}-${cola.length}`}
          carpeta={cola[0]}
          quedan={cola.length - 1}
          carpetas={carpetas}
          dentro={carpeta}
          extra={extra}
          conCarpetas={!deposito}
          onCancelar={() => setCola([])}
          onSaltar={() => setCola((c) => c.slice(1))}
          onHecho={() => { setCola((c) => c.slice(1)); recargar(); }}
        />
      )}
    </div>
  );
}
