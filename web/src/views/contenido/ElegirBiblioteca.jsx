import { useMemo, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { normaliza } from '../../lib/api.js';
import { diaCorto } from '../../lib/fechas.js';
import { Miniatura, Modal, OpcionesCarpetas, textoTipo } from './comun.jsx';

// Elegir de la biblioteca el contenido de una pieza (en vez de subirlo otra vez). Lo de la biblioteca pasa a la
// pieza (al guardar, sale de la biblioteca); lo ya publicado se reutiliza (se queda donde está).
export const enBiblioteca = (p) => !p.fecha && p.estado !== 'publicado' && p.archivos?.length > 0;
const publicada = (p) => (p.estado === 'publicado' || p.ig_estado === 'publicado') && p.archivos?.length > 0;

export default function ElegirBiblioteca({ piezas, carpetas, excluir = [], onElegir, onClose }) {
  const [ver, setVer] = useState('biblioteca');
  const [carpeta, setCarpeta] = useState('');
  const [busca, setBusca] = useState('');
  const [marcadas, setMarcadas] = useState([]);
  const lista = useMemo(() => {
    const b = normaliza(busca.trim());
    return piezas
      .filter((p) => !excluir.includes(p.id) && (ver === 'biblioteca' ? enBiblioteca(p) : publicada(p)))
      .filter((p) => ver !== 'biblioteca' || !carpeta || (carpeta === '-' ? !p.carpeta : p.carpeta === carpeta || String(p.carpeta || '').startsWith(`${carpeta}/`)))
      .filter((p) => !b || normaliza(`${p.titulo}\n${p.caption || ''}`).includes(b))
      .sort((a, b2) => (ver === 'biblioteca' ? b2.id - a.id : String(b2.ig_publicado_en || b2.fecha || '').localeCompare(String(a.ig_publicado_en || a.fecha || ''))));
  }, [piezas, excluir, ver, carpeta, busca]);
  const marcar = (id) => setMarcadas((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const elegir = () => onElegir(marcadas.map((id) => piezas.find((p) => p.id === id)).filter(Boolean).map((p) => ({ pieza: p, mover: enBiblioteca(p) })));

  return (
    <Modal titulo={<><Icon name="book" size={15} />Elegir de la biblioteca</>} onClose={onClose} ancho={900} clase="elegir-bib">
      <div className="bib-barra elegir-bib-barra">
        <div className="seg seg-mini" role="group" aria-label="Qué ver">
          <button type="button" className={ver === 'biblioteca' ? 'on' : ''} onClick={() => setVer('biblioteca')}>Biblioteca</button>
          <button type="button" className={ver === 'publicados' ? 'on' : ''} onClick={() => setVer('publicados')}>Ya publicados</button>
        </div>
        {ver === 'biblioteca' && carpetas.length > 0 && (
          <select className="campo" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} aria-label="Carpeta">
            <option value="">Todas las carpetas</option>
            <option value="-">Sin carpeta</option>
            <OpcionesCarpetas carpetas={carpetas} />
          </select>
        )}
        <input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por título o caption…" />
      </div>
      <div className="ayuda">{ver === 'biblioteca' ? 'Sus fotos y vídeos pasan a esta publicación: al guardar, salen de la biblioteca.' : 'Se reutilizan sus fotos y vídeos; la publicación de antes se queda como está.'}</div>
      <div className="bib-grid elegir-bib-grid">
        {lista.map((p) => {
          const n = marcadas.indexOf(p.id);
          return (
            <div key={p.id} className={`bib-card${n >= 0 ? ' marcada' : ''}`} onClick={() => marcar(p.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && marcar(p.id)}>
              <Miniatura p={p} className="bib-img" />
              <span className="bib-check elegir-check">{n >= 0 ? (marcadas.length > 1 ? n + 1 : '✓') : ''}</span>
              <span className="bib-tipo">{textoTipo(p.formato)}</span>
              {p.archivos.length > 1 && <span className="bib-n">🎞 {p.archivos.length}</span>}
              <div className="bib-pie">
                <div className="fila-c-txt"><b>{p.titulo}</b><small>{ver === 'biblioteca' ? (p.carpeta ? <><Icon name="folder" size={10} /> {p.carpeta}</> : '') : `Publicado ${p.ig_publicado_en ? `el ${diaCorto(p.ig_publicado_en.slice(0, 10))}` : p.fecha ? `el ${diaCorto(p.fecha)}` : ''}`}</small></div>
              </div>
            </div>
          );
        })}
      </div>
      {!lista.length && <div className="vacio">{busca || carpeta ? 'No hay nada que coincida.' : ver === 'biblioteca' ? 'No hay nada con fotos o vídeos en la biblioteca.' : 'Aún no hay publicaciones con fotos o vídeos.'}</div>}
      <div className="modal-pie">
        <span className="ayuda">{marcadas.length ? `${marcadas.length} ${marcadas.length === 1 ? 'elegida' : 'elegidas'} · los archivos se añaden en este orden` : 'Pulsa en una o varias para elegirlas.'}</span>
        <div className="est-semana-btns">
          <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn" onClick={elegir} disabled={!marcadas.length}>Añadir</button>
        </div>
      </div>
    </Modal>
  );
}
