import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';
import { hoyIso } from '../../lib/fechas.js';
import { Miniatura, Modal, esMedio, subirArchivo } from './comun.jsx';

// Programar varias stories de una vez: las que ya están en la biblioteca (p. ej. las de un diseño exportado) o
// las que subes aquí (tus fotos y vídeos, en orden). Cada una es una pieza de tipo Story con su día y su hora;
// si se marca, JARVIS las publica solas en Instagram, en orden (como en Metricool).

const CADA = [[0, 'Todas a la vez (en orden)'], [1, '1 min'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 hora'], [120, '2 horas'], [180, '3 horas']];
const ahoraRedondo = () => { const d = new Date(Date.now() + 20 * 60_000); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return d; };
// El día y la hora de la story n (la primera a «hora» y las demás cada «cada» minutos; si pasa de medianoche, al día siguiente)
export function momentoDe(fecha, hora, n, cada) {
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const t = new Date(a, m - 1, d, h, mi + n * cada);
  return { fecha: t.toLocaleDateString('sv-SE'), hora: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` };
}

function MiniArchivo({ f }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const u = URL.createObjectURL(f); setUrl(u); return () => URL.revokeObjectURL(u); }, [f]);
  if (!url) return <div className="miniatura-c" />;
  return <div className="miniatura-c">{/^video\//.test(f.type) ? <video src={`${url}#t=0.1`} preload="metadata" muted /> : <img src={url} alt="" />}</div>;
}

export default function ProgramarStories({ piezas = null, ig, titulo = 'Stories', onClose, onHecho }) {
  const subir = !piezas; // sin piezas: se suben aquí
  const inicio = ahoraRedondo();
  const [archivos, setArchivos] = useState([]);
  const [nombre, setNombre] = useState(titulo);
  const [fecha, setFecha] = useState(inicio.toLocaleDateString('sv-SE'));
  const [hora, setHora] = useState(`${String(inicio.getHours()).padStart(2, '0')}:${String(inicio.getMinutes()).padStart(2, '0')}`);
  const [cada, setCada] = useState(0);
  const conIg = Boolean(ig?.disponible && !ig.motivo);
  const [enIg, setEnIg] = useState(conIg);
  const [progreso, setProgreso] = useState(null);
  const [errores, setErrores] = useState([]);
  const [sobre, setSobre] = useState(false);
  const total = subir ? archivos.length : piezas.length;
  const yaPublicadas = subir ? 0 : piezas.filter((p) => p.ig_estado === 'publicado').length;

  const anadir = (lista) => {
    const medios = [...lista].filter(esMedio);
    if (!medios.length) return setErrores(['Elige fotos o vídeos.']);
    setErrores([]);
    setArchivos((x) => [...x, ...medios].slice(0, 30));
  };
  const mover = (i, d) => setArchivos((x) => { const j = i + d; if (j < 0 || j >= x.length) return x; const y = [...x]; [y[i], y[j]] = [y[j], y[i]]; return y; });

  const programar = async () => {
    if (!total) return setErrores(['Añade al menos una story.']);
    if (!fecha || !hora) return setErrores(['Pon el día y la hora de la primera.']);
    const pasada = new Date(`${fecha}T${hora}:00`) < new Date();
    if (enIg && pasada && !window.confirm('La hora de la primera ya ha pasado: se publicará en cuanto JARVIS la vea. ¿Seguir?')) return;
    setErrores([]);
    const errs = [];
    let hechas = 0;
    for (let i = 0; i < total; i++) {
      setProgreso({ n: i + 1, total });
      const cuando = momentoDe(fecha, hora, i, cada);
      try {
        let p;
        if (subir) {
          const a = await subirArchivo(archivos[i]);
          p = await api('/api/piezas', { method: 'POST', body: { titulo: total > 1 ? `${nombre.trim() || 'Story'} · ${i + 1}/${total}` : nombre.trim() || 'Story', formato: 'Story', estado: 'listo', ...cuando, archivos: [a] } });
        } else {
          p = piezas[i];
          if (p.ig_estado === 'publicado') continue;
          await api(`/api/piezas/${p.id}`, { method: 'PATCH', body: cuando });
        }
        // Instagram aparte: si algo no vale (p. ej. un formato), la story se queda programada en el calendario igual
        if (enIg) {
          try { await api(`/api/piezas/${p.id}`, { method: 'PATCH', body: { publicar_ig: true } }); }
          catch (e) { errs.push(`Story ${i + 1}: está en el calendario, pero no se publicará sola en Instagram. ${e.message}`); }
        }
        hechas += 1;
      } catch (e) { errs.push(`Story ${i + 1}: ${e.message}`); }
    }
    setProgreso(null);
    if (errs.length) { setErrores(errs); if (hechas) onHecho?.(hechas, true); return; }
    onHecho?.(hechas, false);
  };

  const fin = total ? momentoDe(fecha, hora, total - 1, cada) : null;
  return (
    <Modal titulo={<><Icon name="calendar" size={14} />{subir ? 'Subir y programar stories' : `Programar ${total} ${total === 1 ? 'story' : 'stories'}`}</>} onClose={progreso ? () => {} : onClose} ancho={720} cerrarFuera={false}>
      {subir ? (
        <>
          <div
            className={`soltar${sobre ? ' sobre' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)}
            onDrop={(e) => { e.preventDefault(); setSobre(false); anadir(e.dataTransfer.files); }}
            onClick={() => document.getElementById('subir-stories')?.click()} role="button" tabIndex={0}
          >
            <Icon name="share" size={18} /><span>Arrastra aquí tus stories (fotos o vídeos) o pulsa para elegirlas. Se publican en este orden.</span>
            <input id="subir-stories" type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { anadir(e.target.files); e.target.value = ''; }} />
          </div>
          {archivos.length > 0 && (
            <div className="prog-stories-grid">
              {archivos.map((f, i) => (
                <div key={`${f.name}-${i}`} className="archivo">
                  <MiniArchivo f={f} />
                  <span className="archivo-n">{i + 1}</span>
                  <div className="archivo-acciones">
                    <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Antes">←</button>
                    <button type="button" onClick={() => mover(i, 1)} disabled={i === archivos.length - 1} aria-label="Después">→</button>
                    <button type="button" onClick={() => setArchivos((x) => x.filter((_, j) => j !== i))} aria-label="Quitar">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <label className="campo-et">Nombre</label>
          <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="De qué van (para encontrarlas en el calendario)" maxLength={120} />
        </>
      ) : (
        <div className="prog-stories-grid">
          {piezas.map((p, i) => (
            <div key={p.id} className="archivo" title={p.titulo}>
              <Miniatura p={p} />
              <span className="archivo-n">{i + 1}</span>
              {p.ig_estado === 'publicado' && <span className="prog-stories-ya">Publicada</span>}
            </div>
          ))}
        </div>
      )}

      <div className="dos-col">
        <div><label className="campo-et">Día</label><input type="date" className="campo" value={fecha} min={hoyIso()} onChange={(e) => setFecha(e.target.value)} /></div>
        <div><label className="campo-et">Hora de la primera</label><input type="time" className="campo" value={hora} onChange={(e) => setHora(e.target.value)} /></div>
      </div>
      {total > 1 && (
        <>
          <label className="campo-et">Entre una y otra</label>
          <select className="campo" value={cada} onChange={(e) => setCada(Number(e.target.value))}>{CADA.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </>
      )}
      <label className={`prog-stories-ig${conIg ? '' : ' apagado'}`}>
        <input type="checkbox" checked={enIg && conIg} disabled={!conIg} onChange={(e) => setEnIg(e.target.checked)} />
        <span><b>Publicarlas solas en Instagram</b>{conIg ? ` en @${ig.cuenta}` : ''}<small>{conIg ? 'JARVIS tiene que estar abierto a esa hora (en el VPS lo está siempre).' : ig?.motivo || 'Conecta Instagram (pestaña Instagram) para que se publiquen solas.'}</small></span>
      </label>
      {fin && total > 1 && <p className="ayuda">La primera el {new Date(`${fecha}T${hora}:00`).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{cada ? ` y la última a las ${fin.hora}${fin.fecha !== fecha ? ' del día siguiente' : ''}` : ', todas seguidas en orden'}.{yaPublicadas ? ` ${yaPublicadas} ya publicada${yaPublicadas === 1 ? '' : 's'}: no se toca${yaPublicadas === 1 ? '' : 'n'}.` : ''}</p>}
      {errores.length > 0 && <div className="caja-error">{errores.map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="modal-pie">
        <span className="ayuda">{progreso ? `${subir ? 'Subiendo y programando' : 'Programando'} ${progreso.n} de ${progreso.total}…` : 'Quedan en el calendario de Contenido como stories.'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sec" onClick={onClose} disabled={Boolean(progreso)}>{errores.length ? 'Cerrar' : 'Cancelar'}</button>
          <button type="button" className="btn" onClick={programar} disabled={Boolean(progreso) || !total}><Icon name="calendar" size={14} />{progreso ? 'Programando…' : 'Programar'}</button>
        </div>
      </div>
    </Modal>
  );
}
