import { useEffect, useRef } from 'react';

// Esfera de partículas azules (canvas 2D con proyección 3D: sin WebGL, funciona en cualquier PC).
export default function Sphere({ density = 3800, speed = 1, active = false }) {
  const ref = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, raf = 0, t = 0;

    // Puntos en esfera (distribución de Fibonacci) + ruido radial + polvo exterior.
    const pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < density; i++) {
      const y = 1 - (i / (density - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      const k = 0.82 + Math.random() * 0.22;
      pts.push({ x: Math.cos(th) * r * k, y: y * k, z: Math.sin(th) * r * k, s: Math.random() });
    }
    // Filamentos: rayos desde el núcleo hacia la superficie (aspecto de nebulosa del post)
    const rays = 90;
    for (let r = 0; r < rays; r++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(1 - u * u);
      const dir = [Math.cos(a) * rr, u, Math.sin(a) * rr];
      const n = 10 + Math.floor(Math.random() * 18);
      for (let i = 0; i < n; i++) {
        const k = Math.pow(Math.random(), 0.8) * 0.95;
        const j = 0.035 * k;
        pts.push({ x: dir[0] * k + (Math.random() - 0.5) * j, y: dir[1] * k + (Math.random() - 0.5) * j, z: dir[2] * k + (Math.random() - 0.5) * j, s: Math.random() });
      }
    }
    // Relleno volumétrico
    for (let i = 0; i < density * 0.3; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u), k = Math.pow(Math.random(), 0.45) * 0.85;
      pts.push({ x: Math.cos(a) * r * k, y: u * k, z: Math.sin(a) * r * k, s: Math.random() });
    }
    const dust = [];
    for (let i = 0; i < 260; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u), k = 1.15 + Math.random() * 0.9;
      dust.push({ x: Math.cos(a) * r * k, y: u * k, z: Math.sin(a) * r * k, s: Math.random() });
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      t += 0.0022 * speed * (activeRef.current ? 2.4 : 1);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) * 0.4 * (activeRef.current ? 1 + Math.sin(t * 40) * 0.015 : 1);

      // Halo
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.5);
      g.addColorStop(0, 'rgba(90,150,255,0.38)');
      g.addColorStop(0.25, 'rgba(47,107,255,0.14)');
      g.addColorStop(0.6, 'rgba(30,64,175,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';
      const cosA = Math.cos(t), sinA = Math.sin(t);
      const cosB = Math.cos(0.35), sinB = Math.sin(0.35);
      const plot = (p, scale, base) => {
        let x = p.x * cosA - p.z * sinA;
        let z = p.x * sinA + p.z * cosA;
        let y = p.y * cosB - z * sinB;
        z = p.y * sinB + z * cosB;
        const persp = 2.6 / (2.6 + z);
        const px = cx + x * R * scale * persp;
        const py = cy + y * R * scale * persp;
        const depth = (1 - z) / 2; // 0 detrás, 1 delante
        const tw = 0.6 + 0.4 * Math.sin(t * 30 + p.s * 20);
        const alpha = Math.min(1, base * (0.35 + depth * 0.9) * tw);
        const size = (0.7 + depth * 1.2) * (p.s > 0.97 ? 1.9 : 1);
        ctx.fillStyle = p.s > 0.9 ? `rgba(200,228,255,${alpha})` : p.s > 0.55 ? `rgba(90,160,255,${alpha})` : `rgba(55,115,255,${alpha})`;
        ctx.fillRect(px, py, size, size);
      };
      for (const p of pts) plot(p, 1, 0.9);
      for (const p of dust) plot(p, 1, 0.45);

      // Núcleo
      const c = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.38);
      c.addColorStop(0, 'rgba(235,245,255,0.95)');
      c.addColorStop(0.15, 'rgba(140,190,255,0.6)');
      c.addColorStop(0.5, 'rgba(47,107,255,0.18)');
      c.addColorStop(1, 'rgba(47,107,255,0)');
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [density, speed]);

  return <canvas ref={ref} />;
}
