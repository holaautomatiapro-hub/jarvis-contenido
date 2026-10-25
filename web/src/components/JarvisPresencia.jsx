import Sphere from './Sphere.jsx';
import Mascota from './Mascota.jsx';
import Icon from './Icon.jsx';

// JARVIS «en persona»: la esfera de partículas (se acelera y late cuando te escucha, piensa o habla), la mascota
// con la pose de lo que está haciendo y el estado. Pulsar la esfera o el micro es hablar con él.
// estado: 'listo' | 'escuchando' | 'pensando' | 'hablando'
const POSE = { listo: 'saludando', escuchando: 'base', pensando: 'pensando', hablando: 'senalando' };
const TEXTO = { listo: 'Listo. Pulsa el micro o escríbeme.', escuchando: 'Te escucho…', pensando: 'Pensando…', hablando: 'Hablando…' };

export default function JarvisPresencia({ estado = 'listo', texto, titulo = 'JARVIS', sub, onMicro, microDisponible = true, compacto = false, children }) {
  const activo = estado !== 'listo';
  return (
    <div className={`jarvis-presencia${compacto ? ' compacta' : ''}`}>
      <button type="button" className="sphere-wrap jarvis-esfera" onClick={onMicro} disabled={!onMicro || !microDisponible} aria-label={estado === 'escuchando' ? 'Dejar de escuchar' : 'Hablar con JARVIS'} title={onMicro && microDisponible ? 'Pulsa para hablar con JARVIS' : undefined}>
        <Sphere active={activo} density={compacto ? 1800 : 3800} />
      </button>
      <Mascota pose={POSE[estado] || 'base'} size={compacto ? 72 : 130} className="hero-mascota" />
      <div className="jarvis-presencia-pie">
        <div className="hero-title">{titulo}</div>
        {sub && !compacto && <div className="hero-sub">{sub}</div>}
        <div className={`voz-estado${activo ? ' activo' : ''}`}>{texto || TEXTO[estado]}</div>
        {onMicro && microDisponible && !compacto && (
          <button type="button" className={`mic${estado === 'escuchando' ? ' on' : ''}`} onClick={onMicro} disabled={estado === 'pensando'} aria-label={estado === 'escuchando' ? 'Dejar de escuchar' : 'Hablar con JARVIS'}>
            <Icon name="mic" size={22} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
