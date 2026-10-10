import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../lib/api.js';

const CARPETAS = ['00-Inbox', '01-Ideas', '02-Guiones', '03-Transcripciones', '04-Competencia', '05-Ads', '06-Publicaciones', '07-Diario'];

// Ventana para capturar una idea o crear una nota en el vault.
export default function Captura({ tipo = 'idea', onClose, onDone }) {
  const [modo, setModo] = useState(tipo);
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [carpeta, setCarpeta] = useState('00-Inbox');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const primero = useRef(null);

  useEffect(() => {
    primero.current?.focus();
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [modo, onClose]);

  const guardar = async (e) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError('');
    try {
      const r = modo === 'idea'
        ? await api('/api/ideas', { method: 'POST', body: { texto } })
        : await api('/api/notas', { method: 'POST', body: { titulo, contenido: texto, carpeta } });
      onDone?.(r);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="panel modal" onSubmit={guardar} role="dialog" aria-modal="true" aria-label="Capturar">
        <div className="panel-head">
          <div className="seg">
            <button type="button" className={modo === 'idea' ? 'on' : ''} onClick={() => setModo('idea')}><Icon name="bulb" />Idea</button>
            <button type="button" className={modo === 'nota' ? 'on' : ''} onClick={() => setModo('nota')}><Icon name="doc" />Nota</button>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {modo === 'nota' && (
          <div className="fila">
            <input ref={primero} className="campo" placeholder="Título de la nota" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            <select className="campo" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} style={{ maxWidth: 170 }}>
              {CARPETAS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        )}
        <textarea
          ref={modo === 'idea' ? primero : undefined}
          className="campo"
          rows={modo === 'idea' ? 4 : 8}
          placeholder={modo === 'idea' ? 'Cuéntale tu idea a JARVIS… (la primera línea será el título)' : 'Escribe en Markdown…'}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && guardar(e)}
        />
        {error && <div className="aviso-error">{error}</div>}
        <div className="modal-pie">
          <span className="ayuda">{modo === 'idea' ? 'Se guarda en 01-Ideas y en la columna Idea del pipeline' : `Se guarda en ${carpeta}`} · Ctrl+Enter</span>
          <button className="btn" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  );
}
