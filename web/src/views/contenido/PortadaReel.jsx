import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';
import { Miniatura, Modal, esVideo, subirArchivo } from './comun.jsx';

// La portada del reel (la miniatura que sale en Instagram), como en Metricool: un fotograma del vídeo elegido con
// la barra, una imagen tuya o una hecha con tu sistema de diseño. Sin portada, Instagram usa el primer fotograma.

const tiempo = (s) => { const n = Math.max(0, s || 0); return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}.${Math.floor((n % 1) * 10)}`; };

function ElegirFotograma({ video, onElegido, onClose }) {
  const ref = useRef(null);
  const [duracion, setDuracion] = useState(0);
  const [t, setT] = useState(0);
  const [sinVer, setSinVer] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [previa, setPrevia] = useState(0); // sin vídeo en el navegador: el momento de la vista previa del servidor
  const ir = (s) => { setT(s); if (ref.current && !sinVer) ref.current.currentTime = s; };
  // Si el navegador no sabe abrir el vídeo (p. ej. un .mov HEVC del iPhone), JARVIS dice cuánto dura y enseña cada momento
  useEffect(() => {
    if (!sinVer) return;
    api(`/api/contenido/fotograma/duracion?ruta=${encodeURIComponent(video.path)}`).then((r) => r.duracion && setDuracion(r.duracion)).catch(() => {});
  }, [sinVer, video.path]);
  useEffect(() => {
    if (!sinVer) return undefined;
    const x = setTimeout(() => setPrevia(Math.round(t * 10) / 10), 250);
    return () => clearTimeout(x);
  }, [sinVer, t]);
  const usar = async () => {
    setGuardando(true); setError('');
    try { onElegido(await api('/api/contenido/fotograma', { method: 'POST', body: { path: video.path, segundo: Math.round(t * 10) / 10 } })); }
    catch (e) { setError(e.message); setGuardando(false); }
  };
  // Con las flechas: ← → una décima; con Mayús, un segundo
  const teclas = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const paso = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
    ir(Math.min(Math.max(0, t + paso), duracion || t + paso));
  };
  return (
    <Modal titulo={<><Icon name="palette" size={15} />Portada del reel: elige el fotograma</>} onClose={onClose} ancho={620} cerrarFuera={false} clase="fotograma-modal">
      <div className="fotograma" onKeyDown={teclas} tabIndex={-1}>
        <div className="fotograma-video">
          {sinVer ? <img src={`/api/contenido/fotograma/previa?ruta=${encodeURIComponent(video.path)}&s=${previa}`} alt="" />
            : <video ref={ref} src={video.url} muted playsInline preload="auto"
              onLoadedMetadata={(e) => { setDuracion(e.currentTarget.duration || 0); e.currentTarget.currentTime = 0.1; setT(0.1); }}
              onError={() => setSinVer(true)} />}
          <span className="fotograma-perfil" title="Lo que se ve en la cuadrícula de tu perfil" />
        </div>
        <div className="fotograma-barra">
          <input type="range" min={0} max={duracion || 60} step={0.1} value={t} onChange={(e) => ir(Number(e.target.value))} aria-label="Momento del vídeo" autoFocus />
          <span className="fotograma-t">{tiempo(t)}{duracion ? ` / ${tiempo(duracion)}` : ''}</span>
        </div>
        <div className="ayuda">Mueve la barra (o las flechas ← →; con Mayús, de segundo en segundo). El recuadro marca lo que se ve en la cuadrícula de tu perfil.</div>
      </div>
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn" onClick={usar} disabled={guardando}>{guardando ? 'Sacando el fotograma…' : 'Usar este fotograma'}</button>
      </div>
    </Modal>
  );
}

export default function PortadaReel({ archivos, portada, onCambio, onSubida, onGenerar, onVisor, ocupado }) {
  const video = archivos.find(esVideo);
  const [fotograma, setFotograma] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);
  useEffect(() => { if (!video) setFotograma(false); }, [video]);
  const poner = (a) => { onSubida?.(a); onCambio(a); };
  const subir = async (f) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) return setError('Elige una imagen (JPG o PNG).');
    setSubiendo(true); setError('');
    try { poner(await subirArchivo(f)); } catch (e) { setError(e.message); }
    setSubiendo(false);
  };
  return (
    <div className="portada-reel">
      <label className="campo-et">Portada del reel <span className="t-dim">· la miniatura en Instagram</span></label>
      <div className="portada-reel-c">
        {portada ? (
          <div className="portada-reel-img archivo" title={portada.nombre}>
            <Miniatura p={{ archivos: [portada] }} onClick={() => onVisor([portada], 0)} />
            <div className="archivo-acciones"><button type="button" onClick={() => onCambio(null)} aria-label="Quitar la portada" title="Quitar la portada">✕</button></div>
          </div>
        ) : (
          <div className="portada-reel-vacia">Sin portada: Instagram usa el primer fotograma</div>
        )}
        <div className="portada-reel-btns">
          <button type="button" className="btn btn-sec" onClick={() => setFotograma(true)} disabled={!video || ocupado || subiendo} title={video ? 'Elige el momento del vídeo con una barra' : 'Sube primero el vídeo'}><Icon name="play" size={14} />Elegir fotograma</button>
          <button type="button" className="btn btn-sec" onClick={() => input.current?.click()} disabled={ocupado || subiendo}><Icon name="share" size={14} />{subiendo ? 'Subiendo…' : 'Subir imagen'}</button>
          {onGenerar && <button type="button" className="btn btn-sec" onClick={onGenerar} disabled={ocupado || subiendo} title="Con tu sistema de diseño"><Icon name="sparkle" size={14} />Generar portada</button>}
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>
      {error && <div className="caja-error">{error}</div>}
      {fotograma && video && <ElegirFotograma video={video} onClose={() => setFotograma(false)} onElegido={(a) => { setFotograma(false); poner(a); }} />}
    </div>
  );
}
