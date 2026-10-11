import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Icon from '../components/Icon.jsx';
import { api, obsidianUrl, useRecurso } from '../lib/api.js';

const ICONO_CARPETA = {
  '00-Inbox': 'folder', '01-Ideas': 'bulb', '02-Guiones': 'pen', '03-Transcripciones': 'mic',
  '04-Competencia': 'spy', '05-Ads': 'ads', '06-Publicaciones': 'publish', '07-Diario': 'calendar',
};

// Markdown → HTML seguro. Quita el frontmatter y convierte [[enlaces]] de Obsidian.
function render(md) {
  const sinFront = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const conEnlaces = sinFront.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, dest, alias) =>
    `<a href="#" data-wikilink="${dest.replace(/"/g, '')}">${alias || dest}</a>`);
  return DOMPurify.sanitize(marked.parse(conEnlaces, { breaks: true }), { ADD_ATTR: ['data-wikilink'] });
}
const frontmatter = (md) => {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return m ? Object.fromEntries(m[1].split(/\r?\n/).map((l) => l.split(/:\s*(.*)/).slice(0, 2)).filter(([k]) => k)) : {};
};
const fechaCorta = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');

// Editar una nota: título (nombre del archivo) y el Markdown tal cual, como en Obsidian
function EditorNota({ nota: abierta, onGuardada, onCancelar }) {
  // La versión con la que se abrió: si la nota cambia fuera mientras editas, al guardar se avisa en vez de pisarla
  const [nota] = useState(abierta);
  const [titulo, setTitulo] = useState(nota.titulo);
  const [contenido, setContenido] = useState(nota.contenido);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const texto = useRef(null);
  const cambiada = titulo !== nota.titulo || contenido !== nota.contenido;
  useEffect(() => { texto.current?.focus(); }, []);

  const guardar = async () => {
    if (guardando) return;
    if (!titulo.trim()) return setError('Ponle un título.');
    if (!cambiada) return onCancelar();
    setGuardando(true); setError('');
    try {
      const n = await api('/api/notas', { method: 'PUT', body: { ruta: nota.path, contenido, titulo, modificado: nota.modificado } });
      onGuardada(n);
    } catch (e) { setError(e.message); setGuardando(false); }
  };
  const cancelar = () => { if (!cambiada || window.confirm('¿Descartar los cambios?')) onCancelar(); };
  const teclas = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); guardar(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
  };

  return (
    <div className="nota-editor" onKeyDown={teclas}>
      <header className="nota-cabecera">
        <div className="nota-editor-titulo">
          <div className="label">{nota.path.includes('/') ? nota.path.split('/')[0] : 'Raíz'} · editando</div>
          <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80} aria-label="Título de la nota" />
        </div>
        <div className="nota-acciones">
          <button className="btn btn-sec" onClick={cancelar} disabled={guardando}>Cancelar</button>
          <button className="btn" onClick={guardar} disabled={guardando}><Icon name="check" size={14} />{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </header>
      {error && <div className="aviso-error">{error}</div>}
      <textarea ref={texto} className="campo nota-texto" value={contenido} onChange={(e) => setContenido(e.target.value)} spellCheck aria-label="Contenido de la nota" />
      <div className="ayuda">Markdown, igual que en Obsidian. Ctrl+S guarda · Esc cancela.</div>
    </div>
  );
}

export default function Notas({ onCaptura }) {
  const [notas, recargarNotas] = useRecurso('/api/notas', []);
  const [cfg] = useRecurso('/api/config', { vault: 'JARVIS-Vault' });
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [nota, setNota] = useState(null);
  const [plegadas, setPlegadas] = useState({});
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState(null); // { texto, deshacer? }
  const [error, setError] = useState('');

  // Búsqueda en el contenido (con un pequeño retardo mientras escribes)
  useEffect(() => {
    if (!q.trim()) { setResultados(null); return; }
    const id = setTimeout(() => api(`/api/notas/buscar?q=${encodeURIComponent(q)}`).then(setResultados).catch(() => setResultados([])), 220);
    return () => clearTimeout(id);
  }, [q]);

  // Abre la nota más reciente al entrar
  useEffect(() => { if (!abierta && notas.length) setAbierta(notas[0].path); }, [notas, abierta]);
  useEffect(() => {
    if (!abierta) return;
    api(`/api/notas/leer?ruta=${encodeURIComponent(abierta)}`).then(setNota).catch(() => setNota(null));
  }, [abierta, notas]);
  useEffect(() => { setEditando(false); setError(''); }, [abierta]);
  useEffect(() => {
    if (!aviso) return;
    const id = setTimeout(() => setAviso(null), 8000);
    return () => clearTimeout(id);
  }, [aviso]);

  const guardada = (n) => {
    setEditando(false);
    setNota(n);
    if (n.path !== abierta) setAbierta(n.path);
    setAviso({ texto: 'Nota guardada' });
    recargarNotas();
  };
  const eliminar = async () => {
    if (!window.confirm(`¿Eliminar la nota «${nota.titulo}»?\n\nVa a la papelera del vault (.trash): puedes recuperarla.`)) return;
    try {
      const r = await api(`/api/notas?ruta=${encodeURIComponent(nota.path)}`, { method: 'DELETE' });
      setError('');
      const siguiente = notas.find((x) => x.path !== nota.path);
      setAbierta(siguiente?.path || null);
      setNota(null);
      setAviso({ texto: `«${nota.titulo}» enviada a la papelera`, deshacer: r });
      recargarNotas();
    } catch (e) { setError(e.message); }
  };
  const deshacer = async () => {
    const r = aviso?.deshacer;
    if (!r) return;
    setAviso(null);
    try {
      const n = await api('/api/notas/restaurar', { method: 'POST', body: r });
      setAbierta(n.path);
      recargarNotas();
    } catch (e) { setError(e.message); }
  };

  const grupos = useMemo(() => {
    const g = new Map();
    for (const n of notas) { const k = n.carpeta || 'Raíz'; if (!g.has(k)) g.set(k, []); g.get(k).push(n); }
    return [...g.entries()].sort(([a], [b]) => (a === 'Raíz' ? -1 : b === 'Raíz' ? 1 : a.localeCompare(b)));
  }, [notas]);

  const html = useMemo(() => (nota ? render(nota.contenido) : ''), [nota]);
  const meta = useMemo(() => (nota ? frontmatter(nota.contenido) : {}), [nota]);

  const clickEnNota = (e) => {
    const a = e.target.closest('a[data-wikilink]');
    if (!a) return;
    e.preventDefault();
    const dest = a.dataset.wikilink.toLowerCase();
    const n = notas.find((x) => x.titulo.toLowerCase() === dest || x.path.toLowerCase() === `${dest}.md`);
    if (n) setAbierta(n.path);
  };

  const Item = ({ n, fragmento }) => (
    <button className={`nota-item${abierta === n.path ? ' on' : ''}`} onClick={() => setAbierta(n.path)}>
      <span className="nota-titulo">{n.titulo}</span>
      <span className="nota-fecha">{fechaCorta(n.modificado)}</span>
      {fragmento && <span className="nota-frag">{fragmento}</span>}
    </button>
  );

  return (
    <section className="notas-vista">
      <aside className="panel panel-pad notas-lista">
        <div className="panel-head">
          <span className="label">Vault · {notas.length} notas</span>
          <button className="chip" onClick={() => onCaptura('nota')}><Icon name="plus" />Nueva</button>
        </div>
        <label className="ask buscar">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en tus notas…" aria-label="Buscar en tus notas" />
        </label>
        <div className="notas-scroll">
          {resultados
            ? (resultados.length ? resultados.map((n) => <Item key={n.path} n={n} fragmento={n.fragmento} />) : <div className="vacio">Sin resultados para "{q}"</div>)
            : grupos.map(([carpeta, lista]) => (
              <div key={carpeta} className="grupo">
                <button className="grupo-head" onClick={() => setPlegadas((p) => ({ ...p, [carpeta]: !p[carpeta] }))}>
                  <Icon name={ICONO_CARPETA[carpeta] || 'folder'} size={13} color="var(--accent-2)" />
                  <span>{carpeta}</span>
                  <span className="cuenta">{lista.length}</span>
                  <Icon name={plegadas[carpeta] ? 'chevron' : 'chevronDown'} size={12} color="var(--dim)" />
                </button>
                {!plegadas[carpeta] && lista.map((n) => <Item key={n.path} n={n} />)}
              </div>
            ))}
        </div>
      </aside>

      <article className="panel nota-visor">
        {aviso && (
          <div className="nota-aviso" role="status">
            <span>{aviso.texto}</span>
            {aviso.deshacer && <button className="link-btn" onClick={deshacer}>Deshacer</button>}
            <button className="icon-btn mini" onClick={() => setAviso(null)} aria-label="Cerrar aviso">✕</button>
          </div>
        )}
        {error && <div className="aviso-error">{error}</div>}
        {nota && editando ? (
          <EditorNota key={nota.path} nota={nota} onGuardada={guardada} onCancelar={() => setEditando(false)} />
        ) : nota ? (
          <>
            <header className="nota-cabecera">
              <div>
                <div className="label">{nota.path.includes('/') ? nota.path.split('/')[0] : 'Raíz'}{meta.origen ? ` · vía ${meta.origen}` : ''}</div>
                <h1>{nota.titulo}</h1>
                <div className="nota-fecha">Modificada el {new Date(nota.modificado).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              </div>
              <div className="nota-acciones">
                <button className="btn btn-sec" onClick={() => setEditando(true)}><Icon name="pen" size={14} />Editar</button>
                <a className="btn btn-sec" href={obsidianUrl(cfg.vault, nota.path)}><Icon name="obsidian" size={14} />Obsidian</a>
                <button className="icon-btn" onClick={eliminar} aria-label="Eliminar nota" title="Eliminar (va a la papelera)"><Icon name="trash" /></button>
              </div>
            </header>
            <div className="md" onClick={clickEnNota} onDoubleClick={() => setEditando(true)} dangerouslySetInnerHTML={{ __html: html }} />
          </>
        ) : (
          <div className="vacio" style={{ padding: 40 }}>Elige una nota de la lista.</div>
        )}
      </article>
    </section>
  );
}
