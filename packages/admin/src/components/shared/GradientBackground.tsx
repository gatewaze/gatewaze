import { useEffect } from 'react';

interface GradientProps {
  children: React.ReactNode;
}

// Default gradient colors (Gatewaze brand green)
const defaultGradient = {
  g1: '32, 221, 32',       // Brand Green
  g2: '13, 110, 13',       // Dark Green
  g3: '0, 184, 148',       // Teal
  interactive: '32, 221, 32', // Interactive Green
};

export default function GradientBackground({ children }: GradientProps) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--gradient-g1', defaultGradient.g1);
    root.style.setProperty('--gradient-g2', defaultGradient.g2);
    root.style.setProperty('--gradient-g3', defaultGradient.g3);
    root.style.setProperty('--gradient-interactive', defaultGradient.interactive);
  }, []);

  useEffect(() => {
    let curX = 0;
    let curY = 0;
    let tgX = 0;
    let tgY = 0;
    let animationFrameId: number;

    const interBubble = document.querySelector<HTMLDivElement>('.interactive');
    if (!interBubble) return;

    function move() {
      curX += (tgX - curX) / 5;
      curY += (tgY - curY) / 5;
      interBubble!.style.transform = `translate(${Math.round(curX)}px, ${Math.round(curY)}px)`;
      animationFrameId = requestAnimationFrame(move);
    }

    function handleMouseMove(event: MouseEvent) {
      tgX = event.clientX;
      tgY = event.clientY;
    }

    window.addEventListener('mousemove', handleMouseMove);
    move();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);

  return (
    <>
      <div className="relative min-h-screen">
        {children}
      </div>
      <div className="gradient-bg">
        <svg xmlns="http://www.w3.org/2000/svg" className="fixed">
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
        <div className="gradients-container fixed inset-0 -z-10">
          <div className="g1"></div>
          <div className="g2"></div>
          <div className="g3"></div>
          <div className="interactive"></div>
        </div>
      </div>
    </>
  );
}
