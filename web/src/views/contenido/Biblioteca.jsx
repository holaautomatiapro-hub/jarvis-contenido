import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, normaliza } from '../../lib/api.js';
import { diaCorto } from '../../lib/fechas.js';

const PUBLICADOS = '__publicados';
import { Miniatura, Modal, esMedio, esVideo, mimeDe, ordenNatural, subirArchivo, tamanoLegible, textoTipo, tituloDeArchivo } from './comun.jsx';

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

// ---------- Ventana para revisar una carpeta antes de subirla ----------
function MiniLocal({ f }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const u = URL.createObjectURL(f); setUrl(u); return () => URL.revokeObjectURL(u); }, [f]);
  if (!url) return <div className="miniatura-c mini-local" />;
  return <div className="miniatura-c mini-local">{/^video\//.test(mimeDe(f)) ? <video src={`${url}#t=0.1`} preload="metadata" muted /> : <img src={url} alt="" />}</div>;
}

function VentanaCarpeta({ carpeta, quedan, carpetas, onCancelar, onSaltar, onHecho }) {
  const [lista, setLista] = useState(() => carpeta.archivos.filter(esMedio).sort((a, b) => ordenNatural(a.name, b.name)));
  const puedeCarrusel = lista.length >= 2 && lista.length <= 10;
  const [modo, setModo] = useState(puedeCarrusel ? 'carrusel' : 'separado');
  const [titulo, setTitulo] = useState(carpeta.nombre);
  const [destino, setDestino] = useState(carpeta.nombre);
  const [progreso, setProgreso] = useState(null);
  const [error, setError] = useState('');
  const arrastrado = useRef(null);
  useEffect(() => { if (modo === 'carrusel' && !puedeCarrusel) setModo('separado'); }, [modo, puedeCarrusel]);

  const mover = (i, j) => setLista((l) => { if (j < 0 || j >= l.length) return l; const x = [...l]; const [f] = x.splice(i, 1); x.splice(j, 0, f); return x; });
  const existe = carpetas.some((c) => c.nombre === carpeta.nombre);

  const guardar = async () => {
    if (!lista.length) return setError('No queda ningún archivo.');
    if (modo === 'carrusel' && !puedeCarrusel) return setError('Un carrusel lleva entre 2 y 10 archivos.');
    setError('');
    if (destino && !carpetas.some((c) => c.nombre === destino)) await api('/api/contenido/carpetas', { method: 'POST', body: { nombre: destino } }).catch(() => {});
    const subidos = [];
    try {
      for (let i = 0; i < lista.length; i++) {
        setProgreso(`Subiendo ${i + 1} de ${lista.length}…`);
        subidos.push(await subirArchivo(lista[i]));
      }
      const comun = { estado: 'editar', carpeta: destino || null };
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
        <div>
          <label className="campo-et">Guardar en la carpeta</label>
          <select className="campo" value={destino} onChange={(e) => setDestino(e.target.value)}>
            {!existe && <option value={carpeta.nombre}>{carpeta.nombre} (nueva)</option>}
            {carpetas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
            <option value="">Sin carpeta</option>
          </select>
        </div>
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
export function Biblioteca({ piezas, publicados = [], carpetas, onAbrir, onProgramar, onRepublicar, recargar }) {
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

  const subirSueltos = async (files) => {
    const medios = files.filter(esMedio);
    const errs = [];
    for (let i = 0; i < medios.length; i++) {
      setEstado(`Subiendo ${i + 1} de ${medios.length}…`);
      try {
        const a = await subirArchivo(medios[i]);
        await api('/api/piezas', { method: 'POST', body: { titulo: tituloDeArchivo(a.nombre), formato: esVideo(a) ? 'Reel' : 'Post', estado: 'editar', carpeta: carpeta || null, archivos: [a] } });
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
  const eliminar = () => {
    if (!window.confirm(`¿Eliminar ${marcadas.length} pieza${marcadas.length === 1 ? '' : 's'} y sus archivos?`)) return;
    accion(() => api('/api/contenido/borrar', { method: 'POST', body: { ids: marcadas } }), 'No se pudieron eliminar.');
  };
  const crearCarpeta = async () => {
    try { const r = await api('/api/contenido/carpetas', { method: 'POST', body: { nombre: nueva } }); setNueva(null); setAbierta(r.nombre); recargar(); }
    catch (e) { setErrores([e.message]); }
  };
  const renombrar = async () => {
    try { const r = await api('/api/contenido/carpetas', { method: 'PATCH', body: { de: abierta, a: renombrando } }); setRenombrando(null); setAbierta(r.nombre); recargar(); }
    catch (e) { setErrores([e.message]); }
  };
  const borrarCarpeta = async () => {
    const n = enCarpeta(abierta);
    if (!window.confirm(`¿Eliminar la carpeta «${abierta}»? Sus ${n} pieza${n === 1 ? '' : 's'} no se borran: se quedan sin carpeta.`)) return;
    try { await api(`/api/contenido/carpetas?nombre=${encodeURIComponent(abierta)}`, { method: 'DELETE' }); setAbierta(null); recargar(); }
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
                <b>Arrastra aquí tus vídeos y fotos, o carpetas enteras</b>
                <span className="ayuda">{carpeta ? `Lo que subas suelto irá a la carpeta «${carpeta}».` : 'Con una carpeta podrás ordenar sus archivos y elegir si es un carrusel o stories.'}</span>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="btn btn-sec" onClick={() => inputArchivos.current?.click()}>Elegir archivos</button>
                  <button className="btn btn-sec" onClick={() => inputCarpeta.current?.click()}>Añadir una carpeta</button>
                </div>
              </>
            )}
        <input ref={inputArchivos} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { recibir({ sueltos: [...e.target.files], carpetas: [] }); e.target.value = ''; }} />
        <input ref={inputCarpeta} type="file" multiple hidden webkitdirectory="" directory="" onChange={(e) => { recibir({ sueltos: [], carpetas: carpetasDeInput([...e.target.files]) }); e.target.value = ''; }} />
      </div>
      {errores.length > 0 && <div className="caja-error">{errores.join('\n')}</div>}

      <div className="carpetas-chips">
        <button className={`chip${abierta === null ? ' on' : ''}`} onClick={() => setAbierta(null)}>Todas <span className="cuenta">{piezas.length}</span></button>
        {publicados.length > 0 && <button className={`chip chip-publicados${verPublicados ? ' on' : ''}`} onClick={() => { setAbierta(PUBLICADOS); setMarcadas([]); }} title="Lo que ya publicaste, para volver a subirlo otro día"><Icon name="checkCircle" />Publicados <span className="cuenta">{publicados.length}</span></button>}
        {carpetas.length > 0 && <button className={`chip${abierta === '' ? ' on' : ''}`} onClick={() => setAbierta('')}>Sin carpeta <span className="cuenta">{sinCarpeta}</span></button>}
        {carpetas.map((c) => (
          <button key={c.nombre} className={`chip${abierta === c.nombre ? ' on' : ''}`} onClick={() => setAbierta(c.nombre)}><Icon name="folder" />{c.nombre} <span className="cuenta">{enCarpeta(c.nombre)}</span></button>
        ))}
        {nueva === null ? <button className="chip discontinuo" onClick={() => setNueva('')}><Icon name="plus" />Nueva carpeta</button> : (
          <span className="en-linea">
            <input autoFocus className="campo" placeholder="Nombre de la carpeta" value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={teclas(crearCarpeta, () => setNueva(null))} />
            <button className="btn btn-sec" onClick={crearCarpeta}>Crear</button>
            <button className="link-btn" onClick={() => setNueva(null)}>Cancelar</button>
          </span>
        )}
      </div>

      {carpeta && (
        <div className="carpeta-abierta">
          {renombrando === null ? (
            <>
              <b><Icon name="folder" size={14} /> {abierta}</b>
              <button className="link-btn" onClick={() => setRenombrando(abierta)}>✎ Renombrar</button>
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
      )}

      <div className="bib-barra">
        {marcadas.length ? (
          <>
            <b>{marcadas.length} marcada{marcadas.length === 1 ? '' : 's'}</b>
            <button className="btn btn-sec" disabled={marcadas.length < 2} onClick={juntar} title="En el orden en que las has marcado"><Icon name="layers" size={13} />Juntar en un carrusel</button>
            <select className="campo" value="-" onChange={(e) => moverA(e.target.value === '__sin' ? '' : e.target.value)} style={{ width: 180 }} aria-label="Mover a carpeta">
              <option value="-" disabled>Mover a carpeta…</option>
              {carpetas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
              <option value="__sin">Sin carpeta</option>
            </select>
            <button className="btn btn-sec peligro" onClick={eliminar}>Eliminar</button>
            <button className="link-btn" onClick={() => setMarcadas([])}>Desmarcar</button>
          </>
        ) : (
          <>
            <div className="buscar-mini"><Icon name="search" size={13} /><input placeholder="Buscar en la biblioteca" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
            <span className="ayuda" style={{ marginLeft: 'auto' }}>{verPublicados ? `${publicados.length} ya publicados · «Volver a publicar» hace una copia con los mismos archivos` : `${piezas.length} sin programar`}</span>
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
                    <div className="fila-c-txt"><b>{p.titulo}</b>{p.carpeta && p.carpeta !== abierta && <small><Icon name="folder" size={10} /> {p.carpeta}</small>}</div>
                    <button className="btn btn-sec bib-prog" onClick={() => onProgramar(p)} title="Elegir día y pasarla al calendario"><Icon name="calendar" size={12} />Programar</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!lista.length && <div className="vacio">{verPublicados ? 'Nada coincide con la búsqueda.' : piezas.length ? 'Nada coincide con la búsqueda o la carpeta.' : 'La biblioteca está vacía. Arrastra arriba tu contenido.'}</div>}

      {cola.length > 0 && (
        <VentanaCarpeta
          key={`${cola[0].nombre}-${cola.length}`}
          carpeta={cola[0]}
          quedan={cola.length - 1}
          carpetas={carpetas}
          onCancelar={() => setCola([])}
          onSaltar={() => setCola((c) => c.slice(1))}
          onHecho={() => { setCola((c) => c.slice(1)); recargar(); }}
        />
      )}
    </div>
  );
}
