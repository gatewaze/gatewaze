import { useRef, useState, useEffect, ReactNode } from 'react';
import { useGlowPosition } from './glow-context';

interface Props {
  children: ReactNode;
  className?: string;
  borderRadius?: string;
  useDarkTheme?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  glowSize?: number;
  borderWidth?: number;
}

function getPositionOnBorder(angle: number, width: number, height: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const halfW = width / 2;
  const halfH = height / 2;

  let scale: number;
  if (Math.abs(dx) * halfH > Math.abs(dy) * halfW) {
    scale = halfW / Math.abs(dx);
  } else {
    scale = halfH / Math.abs(dy);
  }

  return {
    x: halfW + dx * scale,
    y: halfH + dy * scale,
  };
}

export function GlowBorder({
  children,
  className = '',
  borderRadius = '1rem',
  useDarkTheme = false,
  autoRotate = false,
  autoRotateSpeed = 30,
  glowSize = 200,
  borderWidth = 1,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [glowStyle, setGlowStyle] = useState({ angle: 0, intensity: 1 });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const glowPosition = useGlowPosition();

  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateDimensions();
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!autoRotate) return;

    let animationFrame: number;
    let lastTime = performance.now();

    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - lastTime) / 1000;
      lastTime = currentTime;
      setGlowStyle((prev) => ({
        angle: (prev.angle + autoRotateSpeed * deltaTime) % 360,
        intensity: 1,
      }));
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [autoRotate, autoRotateSpeed]);

  useEffect(() => {
    if (autoRotate) return;
    if (!containerRef.current || glowPosition.source === 'none') return;

    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const angle = Math.atan2(glowPosition.y - centerY, glowPosition.x - centerX);
    const angleDeg = ((angle * 180) / Math.PI + 90 + 360) % 360;

    setGlowStyle({ angle: angleDeg, intensity: 1 });
  }, [glowPosition, autoRotate]);

  const glowColor = useDarkTheme ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.7)';
  const baseColor = useDarkTheme ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)';

  const glowPos1 = getPositionOnBorder(glowStyle.angle, dimensions.width, dimensions.height);
  const glowPos2 = getPositionOnBorder((glowStyle.angle + 180) % 360, dimensions.width, dimensions.height);

  const glow1X = dimensions.width > 0 ? (glowPos1.x / dimensions.width) * 100 : 50;
  const glow1Y = dimensions.height > 0 ? (glowPos1.y / dimensions.height) * 100 : 0;
  const glow2X = dimensions.width > 0 ? (glowPos2.x / dimensions.width) * 100 : 50;
  const glow2Y = dimensions.height > 0 ? (glowPos2.y / dimensions.height) * 100 : 100;

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={{ borderRadius }}
    >
      {children}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          borderRadius,
          padding: `${borderWidth}px`,
          background: `
            radial-gradient(${glowSize}px ${glowSize}px at ${glow1X}% ${glow1Y}%, ${glowColor} 0%, transparent 70%),
            radial-gradient(${glowSize}px ${glowSize}px at ${glow2X}% ${glow2Y}%, ${glowColor} 0%, transparent 70%),
            ${baseColor}
          `,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude',
          opacity: 0.1 + glowStyle.intensity * 0.9,
          transition: 'opacity 0.15s ease-out',
        }}
      />
    </div>
  );
}
