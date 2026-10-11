import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { COLORES, MODOS, POR_DEFECTO, esHex, guardar, leer, seguirSistema } from '../lib/apariencia.js';

// Botón de la barra superior que abre el panel para elegir modo (oscuro/claro) y color de acento.
export default function Apariencia() {
  const [abierto, setAbierto] = useState(false);
  const [a, setA] = useState(leer);
  const [hex, setHex] = useState(a.acento);
  const caja = useRef(null);

  useEffect(() => seguirSistema(), []);

  // Cierra al pulsar fuera o con Escape
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);

  const cambiar = (parcial) => {
    const nueva = { ...a, ...parcial };
    setA(nueva);
    if (parcial.acento) setHex(parcial.acento);
    guardar(nueva);
  };

  const escribirHex = (v) => {
    const t = v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`;
    setHex(v);
    if (esHex(t)) cambiar({ acento: t.toLowerCase() });
  };

  const acento = a.acento.toLowerCase();
  const propio = !COLORES.some((c) => c.hex === acento);

  return (
    <div className="apariencia" ref={caja}>
      <button className={`icon-btn${abierto ? ' on' : ''}`} aria-label="Apariencia: modo y color" aria-expanded={abierto} title="Apariencia" onClick={() => setAbierto((v) => !v)}>
        <Icon name="palette" />
      </button>
      {abierto && (
        <div className="apariencia-menu panel" role="dialog" aria-label="Apariencia">
          <div className="label">Modo</div>
          <div className="seg seg-ancho">
            {MODOS.map((m) => (
              <button key={m.id} className={a.modo === m.id ? 'on' : ''} onClick={() => cambiar({ modo: m.id })}>
                <Icon name={m.id === 'oscuro' ? 'moon' : m.id === 'claro' ? 'sun' : 'monitor'} />
                {m.label}
              </button>
            ))}
          </div>

          <div className="label" style={{ marginTop: 14 }}>Color principal</div>
          <div className="muestras">
            {COLORES.map((c) => (
              <button
                key={c.hex}
                className={`muestra${acento === c.hex ? ' on' : ''}`}
                style={{ '--c': c.hex }}
                title={c.nombre}
                aria-label={c.nombre}
                aria-pressed={acento === c.hex}
                onClick={() => cambiar({ acento: c.hex })}
              />
            ))}
            <label className={`muestra muestra-libre${propio ? ' on' : ''}`} style={propio ? { '--c': acento } : undefined} title="Elegir cualquier color">
              <input type="color" value={acento} onChange={(e) => cambiar({ acento: e.target.value })} aria-label="Elegir cualquier color" />
              {!propio && <Icon name="plus" size={12} />}
            </label>
          </div>
          <div className="apariencia-hex">
            <span className="muestra-actual" />
            <input className="campo" value={hex} onChange={(e) => escribirHex(e.target.value)} spellCheck="false" maxLength={7} aria-label="Código de color (hex)" placeholder="#2f6bff" />
            <button className="btn btn-sec" disabled={a.modo === POR_DEFECTO.modo && acento === POR_DEFECTO.acento} onClick={() => cambiar({ ...POR_DEFECTO })}>Restablecer</button>
          </div>
          <p className="apariencia-nota">Se guarda en este navegador.</p>
        </div>
      )}
    </div>
  );
}
