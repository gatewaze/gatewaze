import { useEffect, useRef } from 'react';

// Brand-specific gradient colors (RGB triplets)
const gradientConfigs = {
  mlops: {
    g1: '233, 68, 239',       // Pink
    g2: '72, 148, 236',       // Blue
    g3: '147, 51, 234',       // Purple
    interactive: '202, 42, 127', // Brand Pink
  },
  techtickets: {
    g1: '255, 166, 0',        // Warm Orange
    g2: '147, 51, 234',       // Deep Purple
    g3: '0, 184, 148',        // Teal
    interactive: '255, 166, 0', // Interactive Orange
  },
};

type BrandId = keyof typeof gradientConfigs;

interface GradientBackgroundProps {
  brand?: BrandId;
}

export function GradientBackground({ brand = 'mlops' }: GradientBackgroundProps) {
  const interactiveRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Set CSS custom properties for gradient colors
  useEffect(() => {
    const config = gradientConfigs[brand] || gradientConfigs.mlops;
    const root = document.documentElement;
    root.style.setProperty('--gradient-g1', config.g1);
    root.style.setProperty('--gradient-g2', config.g2);
    root.style.setProperty('--gradient-g3', config.g3);
    root.style.setProperty('--gradient-interactive', config.interactive);
  }, [brand]);

  // Mouse-tracking interactive gradient, offset by container position
  useEffect(() => {
    let curX = 0;
    let curY = 0;
    let tgX = 0;
    let tgY = 0;
    let animationFrameId: number;

    const el = interactiveRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    function move() {
      curX += (tgX - curX) / 5;
      curY += (tgY - curY) / 5;
      el!.style.transform = `translate(${Math.round(curX)}px, ${Math.round(curY)}px)`;
      animationFrameId = requestAnimationFrame(move);
    }

    function handleMouseMove(event: MouseEvent) {
      const rect = container!.getBoundingClientRect();
      tgX = event.clientX - rect.left;
      tgY = event.clientY - rect.top;
    }

    window.addEventListener('mousemove', handleMouseMove);
    move();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="gradient-bg" ref={containerRef}>
      <svg xmlns="http://www.w3.org/2000/svg" className="hidden">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>
      <div className="gradients-container">
        <div className="g1" />
        <div className="g2" />
        <div className="g3" />
        <div className="interactive" ref={interactiveRef} />
      </div>
    </div>
  );
}
