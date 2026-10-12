import { useCallback, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useRecurso } from '../lib/api.js';
import { Diseno } from './contenido/Diseno.jsx';
import { EditorContenido, ProgramarContenido, Visor } from './contenido/Editor.jsx';
import { Preparar } from './laboratorio/comun.jsx';
import Testimonios from './laboratorio/Testimonios.jsx';
import Reels from './laboratorio/Reels.jsx';
import LeadMagnets from './laboratorio/LeadMagnets.jsx';

// Laboratorio: donde se crea lo visual. Diseño (carruseles y stories), clips de testimonios, edición de reels,
// lead magnets (páginas web publicadas en Vercel) e imágenes.
const SECCIONES = [
  { id: 'diseno', label: 'Diseño', icon: 'palette', ayuda: 'Carruseles y stories con tu sistema de diseño' },
  { id: 'testimonios', label: 'Testimonios', icon: 'users', ayuda: 'De la entrevista a clips, stories, carrusel, portada y captions' },
  { id: 'reels', label: 'Reels', icon: 'play', ayuda: 'Tus vídeos: mejores momentos, subtítulos y sin muletillas' },
  { id: 'leadmagnets', label: 'Lead magnets', icon: 'target', ayuda: 'Guías, checklists y tests en una página web, publicados con un enlace' },
  { id: 'imagenes', label: 'Imágenes', icon: 'eye', ayuda: 'Imágenes, B-roll y avatares con IA' },
];
const guardada = () => { try { const v = localStorage.getItem('lab_seccion'); return SECCIONES.some((s) => s.id === v) ? v : 'diseno'; } catch { return 'diseno'; } };

export default function Laboratorio() {
  const [seccion, setSeccionEstado] = useState(guardada);
  const setSeccion = (v) => { setSeccionEstado(v); try { localStorage.setItem('lab_seccion', v); } catch { /* sin localStorage */ } };
  const [lab, recargarLab, errorLab] = useRecurso(['testimonios', 'reels', 'leadmagnets'].includes(seccion) ? '/api/laboratorio' : null, null);
  const [contenido, recargarContenido] = useRecurso(seccion === 'diseno' ? '/api/contenido' : null, null);
  const [editando, setEditando] = useState(null);
  const [programando, setProgramando] = useState(null);
  const [visor, setVisor] = useState(null);
  const piezas = useMemo(() => contenido?.piezas || [], [contenido]);
  const abrirVisor = useCallback((archivos, inicio) => setVisor({ archivos, inicio }), []);
  const actual = SECCIONES.find((s) => s.id === seccion);

  return (
    <section className="lab-vista">
      <div className="panel panel-pad lab-cabecera">
        <div>
          <div className="label">Laboratorio</div>
          <h1 className="vista-titulo">{actual.label}</h1>
          <p className="ayuda">{actual.ayuda}</p>
        </div>
        <div className="seg lab-secciones">
          {SECCIONES.map((s) => <button key={s.id} className={seccion === s.id ? 'on' : ''} onClick={() => setSeccion(s.id)}><Icon name={s.icon} />{s.label}</button>)}
        </div>
      </div>

      {seccion === 'diseno' && <Diseno piezas={piezas} ig={contenido?.instagram} onAbrir={setEditando} onProgramar={(p) => setProgramando({ p })} />}
      {(seccion === 'testimonios' || seccion === 'reels') && (!lab ? (
        <div className="panel panel-pad vacio">
          {errorLab ? <>No se ha podido cargar el Laboratorio: {errorLab}.<br />Si acabas de actualizar JARVIS en el VPS, espera a que termine el instalador y recarga la página.</> : 'Cargando…'}
        </div>
      ) : (
        <>
          {!(lab.plugin.instalado && lab.python && lab.marca.verificado) && <Preparar data={lab} recargar={recargarLab} />}
          {seccion === 'testimonios' ? <Testimonios data={lab} recargar={recargarLab} /> : <Reels data={lab} />}
        </>
      ))}
      {seccion === 'leadmagnets' && <LeadMagnets trabajando={Boolean(lab?.trabajando)} />}
      {seccion === 'imagenes' && (
        <div className="panel panel-pad lab-pronto">
          <Icon name="sparkle" size={22} color="var(--accent-2)" />
          <b>Imágenes, B-roll y avatares con IA</b>
          <p className="ayuda">Llega en la siguiente fase: imágenes para tus diseños, B-roll y vídeos, y avatares con tu cara (Higgsfield), directos a tu biblioteca.</p>
        </div>
      )}

      {editando && <EditorContenido key={editando.id || 'nuevo'} pieza={editando} carpetas={contenido?.carpetas || []} ig={contenido?.instagram} onClose={() => setEditando(null)} onGuardado={recargarContenido} onVisor={abrirVisor} onRepublicar={() => {}} />}
      {programando && <ProgramarContenido pieza={programando.p} ig={contenido?.instagram} onClose={() => setProgramando(null)} onGuardado={recargarContenido} />}
      {visor && <Visor archivos={visor.archivos} inicio={visor.inicio} onClose={() => setVisor(null)} />}
    </section>
  );
}
