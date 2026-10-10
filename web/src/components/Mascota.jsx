// Mascota de JARVIS. Poses en web/public/mascota/: base, saludando, senalando, sentada, pensando.
export default function Mascota({ pose = 'base', size = 140, float = true, className = '', style }) {
  return (
    <img
      src={`/mascota/${pose}.webp`}
      alt=""
      aria-hidden="true"
      draggable="false"
      className={`mascota${float ? ' mascota-float' : ''} ${className}`}
      style={{ width: size, height: size, ...style }}
    />
  );
}
