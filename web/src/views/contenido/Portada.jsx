import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';
import { Modal, esVideo, subirArchivo } from './comun.jsx';

// «Generar portada»: eliges una de tus plantillas (cada una es una portada tuya de referencia: Carrusel,
// Testimonio… y las que añadas), el título, qué quieres y, si quieres, una foto. JARVIS copia el diseño de la
// referencia (salvo lo que pidas distinto), se exporta a JPG y se añade sola a la pieza: en un reel queda como
// su portada; en un carrusel o un post, como primera imagen.
const FORMATOS_VIDEO = ['Reel', 'Short', 'Reel split', 'B-roll'];
export const esFormatoVideo = (f) => FORMATOS_VIDEO.includes(f);

export default function GenerarPortada({ pieza, onHecha, onClose, onSegundoPlano }) {
  const [tipos, setTipos] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ tipo: '', titulo: pieza.titulo || '', descripcion: '', foto: null, sinFondo: true });
  const [aviso, setAviso] = useState('');
  const [estado, setEstado] = useState(null); // null | { id, texto }
  const [subiendo, setSubiendo] = useState(false);
  const input = useRef(null);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  useEffect(() => {
    api('/api/portadas').then((r) => {
      setTipos(r.tipos);
      const preferido = r.tipos.find((t) => t.muestra && (esFormatoVideo(pieza.formato) ? t.formato === 'story' : t.formato === 'carrusel')) || r.tipos.find((t) => t.muestra) || r.tipos[0];
      setF((x) => ({ ...x, tipo: x.tipo || preferido?.id || '' }));
    }).catch((e) => setError(e.message));
  }, [pieza.formato]);

  const fotosPieza = (pieza.archivos || []).filter((a) => !esVideo(a)).slice(0, 8);
  // Plantillas: subir o cambiar la imagen de referencia, añadir otra y borrar
  const ref = useRef(null);
  const [subiendoRef, setSubiendoRef] = useState('');
  const [nueva, setNueva] = useState(null); // { nombre, formato }
  const subirReferencia = async (file, { id, nombre, formato } = {}) => {
    if (!file) return;
    setSubiendoRef(id || 'nueva'); setError('');
    try {
      const q = new URLSearchParams({ nombre_archivo: file.name, ...(id ? { id } : { nombre: nombre || '', formato: formato || 'carrusel' }) });
      const r = await fetch(`/api/portadas/plantillas?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se ha podido subir la imagen');
      setTipos(d.tipos);
      if (!id) { setNueva(null); setF((x) => ({ ...x, tipo: d.tipos.at(-1).id })); }
    } catch (e) { setError(e.message); }
    setSubiendoRef('');
  };
  const borrarPlantilla = async (t) => {
    if (!window.confirm(`¿Borrar la plantilla «${t.nombre}»?`)) return;
    try { const d = await api(`/api/portadas/plantillas/${t.id}`, { method: 'DELETE' }); setTipos(d.tipos); setF((x) => ({ ...x, tipo: x.tipo === t.id ? d.tipos[0]?.id || '' : x.tipo })); } catch (e) { setError(e.message); }
  };
  const actual = tipos?.find((t) => t.id === f.tipo);
  const subir = async (file) => {
    if (!file) return;
    setSubiendo(true); setError('');
    try { const a = await subirArchivo(file); setF((x) => ({ ...x, foto: a })); } catch (e) { setError(e.message); }
    setSubiendo(false);
  };

  const esperar = async (id) => {
    for (let i = 0; i < 300 && vivo.current; i++) {
      await new Promise((ok) => setTimeout(ok, 2000));
      const d = await api(`/api/disenos/${id}`).catch(() => null);
      if (!d) continue;
      if (d.estado === 'error') throw new Error(d.error || 'No se ha podido hacer la portada');
      if (d.estado === 'listo' && d.previas.length) return d;
      if (d.estado === 'listo' && d.error) throw new Error(d.error);
      setEstado({ id, texto: d.estado === 'renderizando' ? 'Dibujando la portada…' : 'JARVIS está diseñando la portada con tu sistema de diseño…', previa: d.previas[0] || null });
    }
    throw new Error('Está tardando demasiado. Mira el diseño en Laboratorio → Diseño.');
  };

  const generar = async () => {
    setError('');
    if (f.foto) setEstado({ id: null, texto: f.sinFondo ? 'Quitando el fondo de la foto…' : 'Preparando…' });
    try {
      const r = await api('/api/portadas', { method: 'POST', body: { tipo: f.tipo, titulo: f.titulo, descripcion: f.descripcion, foto: f.foto, sinFondo: f.sinFondo, ...(pieza.id ? { pieza_id: pieza.id } : { pieza: { titulo: pieza.titulo, formato: pieza.formato, archivos: pieza.archivos } }) } });
      setAviso(r.aviso || '');
      setEstado({ id: r.id, texto: 'JARVIS está diseñando la portada con tu sistema de diseño…' });
      const d = await esperar(r.id);
      if (!vivo.current) return;
      setEstado({ id: r.id, texto: 'Guardando la imagen…', previa: d.previas[0] });
      const archivo = await api(`/api/portadas/${r.id}/exportar`, { method: 'POST' });
      if (!vivo.current) return;
      onHecha(archivo);
      onClose();
    } catch (e) { if (vivo.current) { setEstado(null); setError(e.message); } }
  };

  const trabajando = Boolean(estado);
  // Si la pieza ya está guardada, la portada se termina y se le añade sola en el servidor: se puede cerrar
  const enSegundoPlano = Boolean(pieza.id && estado?.id);
  const seguirEnSegundoPlano = () => { onSegundoPlano?.(); onClose(); };
  const cerrar = () => {
    if (enSegundoPlano) return seguirEnSegundoPlano();
    if (!trabajando || window.confirm('JARVIS sigue haciendo la portada. Como la pieza aún no está guardada, si cierras no se añadirá a ella (la tendrás en Laboratorio → Diseño). ¿Cerrar?')) onClose();
    return undefined;
  };
  return (
    <Modal titulo="Generar portada" onClose={cerrar} ancho={760} cerrarFuera={false}>
      {estado ? (
        <div className="portada-haciendo">
          {estado.previa ? <img src={estado.previa} alt="" /> : <div className="portada-spinner"><Icon name="sparkle" size={22} /></div>}
          <b>{estado.texto}</b>
          {aviso && <span className="aviso error">{aviso}</span>}
          <span className="ayuda">Tarda unos minutos. Cuando esté, se añade sola a la pieza{esFormatoVideo(pieza.formato) ? ' como portada del reel' : ' como primera imagen'}.{enSegundoPlano ? ' Puedes cerrar esta ventana y seguir con otras cosas: lo ves arriba, en «Trabajando».' : ''}</span>
        </div>
      ) : (
        <>
          <label className="campo-et">Plantilla</label>
          {!tipos ? <div className="ayuda">{error || 'Cargando plantillas…'}</div> : (
            <div className="portada-tipos">
              {tipos.map((t) => (
                <div key={t.id} className={`portada-tipo${f.tipo === t.id ? ' on' : ''}`}>
                  <button type="button" className={`portada-muestra ${t.formato}`} onClick={() => (t.muestra ? setF({ ...f, tipo: t.id }) : (setF({ ...f, tipo: t.id }), ref.current?.click()))} title={t.muestra ? `Usar «${t.nombre}»` : 'Subir la portada de referencia'}>
                    {t.muestra ? <img src={t.muestra} alt="" loading="lazy" /> : <span className="portada-sin"><Icon name="plus" size={18} /><small>{subiendoRef === t.id ? 'Subiendo…' : 'Sube tu portada de referencia'}</small></span>}
                  </button>
                  <b>{t.nombre}</b>
                  <small>{t.formato === 'story' ? '9:16' : '4:5'}{t.descripcion ? ` · ${t.descripcion}` : ''}</small>
                  {f.tipo === t.id && (
                    <span className="portada-acciones">
                      <button type="button" className="link-btn" onClick={() => ref.current?.click()}>{t.muestra ? 'Cambiar imagen' : 'Subir imagen'}</button>
                      {tipos.length > 1 && <button type="button" className="link-btn peligro" onClick={() => borrarPlantilla(t)}>Borrar</button>}
                    </span>
                  )}
                </div>
              ))}
              {nueva ? (
                <div className="portada-tipo portada-nueva">
                  <input className="campo" autoFocus value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Nombre (p. ej. Lanzamiento)" maxLength={40} />
                  <select className="campo" value={nueva.formato} onChange={(e) => setNueva({ ...nueva, formato: e.target.value })}>
                    <option value="carrusel">Carrusel / post 4:5</option>
                    <option value="story">Reel / story 9:16</option>
                  </select>
                  <button type="button" className="btn btn-sec" disabled={!nueva.nombre.trim() || subiendoRef === 'nueva'} onClick={() => ref.current?.click()}><Icon name="plus" size={13} />{subiendoRef === 'nueva' ? 'Subiendo…' : 'Elegir su imagen'}</button>
                  <button type="button" className="link-btn" onClick={() => setNueva(null)}>Cancelar</button>
                </div>
              ) : (
                <button type="button" className="portada-tipo portada-anadir" onClick={() => setNueva({ nombre: '', formato: 'carrusel' })}><Icon name="plus" size={16} /><b>Añadir plantilla</b><small>Sube otra portada tuya de referencia</small></button>
              )}
              <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (nueva) subirReferencia(file, nueva); else subirReferencia(file, { id: f.tipo }); }} />
            </div>
          )}
          {actual && !actual.muestra && <div className="ayuda">Sube la imagen de «{actual.nombre}»: JARVIS copiará su diseño y solo cambiará el texto y la foto.</div>}
          <label className="campo-et">Título</label>
          <input className="campo" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="3 errores al contratar a tu primer setter" maxLength={160} />
          <label className="campo-et">Qué quieres</label>
          <textarea className="campo" rows={3} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} placeholder="Lo que quieras distinto a la plantilla, p. ej. «fondo blanco con letras negras», «la palabra SETTER en amarillo», «yo a la derecha»…" />
          <label className="campo-et">Foto (opcional)</label>
          <div className="portada-fotos">
            {f.foto && !fotosPieza.some((a) => a.url === f.foto.url) && (
              <button type="button" className="portada-foto on" onClick={() => setF({ ...f, foto: null })} title="Quitar"><img src={f.foto.url} alt="" /></button>
            )}
            {fotosPieza.map((a) => (
              <button type="button" key={a.url} className={`portada-foto${f.foto?.url === a.url ? ' on' : ''}`} onClick={() => setF({ ...f, foto: f.foto?.url === a.url ? null : a })} title={a.nombre}><img src={a.url} alt="" /></button>
            ))}
            <button type="button" className="portada-foto portada-subir" onClick={() => input.current?.click()} disabled={subiendo}><Icon name="plus" size={15} /><small>{subiendo ? 'Subiendo…' : 'Subir'}</small></button>
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <label className="portada-sinfondo"><input type="checkbox" checked={f.sinFondo} onChange={(e) => setF({ ...f, sinFondo: e.target.checked })} />Quitar el fondo de la foto (la persona va recortada, como en tus portadas)</label>
        </>
      )}
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        {enSegundoPlano
          ? <button type="button" className="btn btn-sec" onClick={seguirEnSegundoPlano}>Seguir en segundo plano</button>
          : <button type="button" className="btn btn-sec" onClick={onClose} disabled={trabajando}>Cancelar</button>}
        <button type="button" className="btn" onClick={generar} disabled={trabajando || !f.tipo || !actual?.muestra || !f.titulo.trim() || subiendo}><Icon name="sparkle" size={14} />{trabajando ? 'Generando…' : 'Generar'}</button>
      </div>
    </Modal>
  );
}
