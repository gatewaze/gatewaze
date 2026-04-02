import { useEffect, useRef, useCallback } from 'react';

interface TrailPixel {
  x: number;
  y: number;
  opacity: number;
}

const GRID_SIZE = 32;
const FADE_RATE = 0.015;

function hexToRgb(hex: string): string {
  hex = hex.trim().replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

export default function PixelTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<Map<string, TrailPixel>>(new Map());
  const animFrameRef = useRef<number>(0);
  const colorRef = useRef<string>('32, 221, 32'); // fallback green RGB

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Read accent color from Radix theme CSS variable
    const accentHex = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-9')
      .trim();
    if (accentHex) {
      colorRef.current = hexToRgb(accentHex);
    }

    // Size canvas
    resize();
    window.addEventListener('resize', resize);

    // Mouse tracking — only drop a pixel every DROP_INTERVAL ms
    const DROP_INTERVAL = 80;
    let lastDropTime = 0;

    function handleMouseMove(e: MouseEvent) {
      const now = performance.now();
      if (now - lastDropTime < DROP_INTERVAL) return;
      lastDropTime = now;

      const snappedX = Math.floor(e.clientX / GRID_SIZE) * GRID_SIZE;
      const snappedY = Math.floor(e.clientY / GRID_SIZE) * GRID_SIZE;
      const key = `${snappedX},${snappedY}`;

      trailRef.current.set(key, { x: snappedX, y: snappedY, opacity: 0.35 });
    }

    window.addEventListener('mousemove', handleMouseMove);

    // Animation loop
    function animate() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const trail = trailRef.current;
      for (const [key, pixel] of trail) {
        pixel.opacity -= FADE_RATE;
        if (pixel.opacity <= 0) {
          trail.delete(key);
          continue;
        }
        ctx.fillStyle = `rgba(${colorRef.current}, ${pixel.opacity})`;
        ctx.fillRect(pixel.x, pixel.y, GRID_SIZE, GRID_SIZE);
      }

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [resize]);

  return (
    <canvas
      ref={canvasRef}
      className="pixel-trail"
      aria-hidden="true"
    />
  );
}
