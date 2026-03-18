import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

interface GlowPosition {
  x: number;
  y: number;
  source: 'mouse' | 'tilt' | 'none';
}

const GlowContext = createContext<GlowPosition>({ x: 0, y: 0, source: 'none' });

export function useGlowPosition() {
  return useContext(GlowContext);
}

export function GlowProvider({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState<GlowPosition>({ x: 0, y: 0, source: 'none' });

  const handleMouseMove = useCallback((e: MouseEvent) => {
    setPosition({ x: e.clientX, y: e.clientY, source: 'mouse' });
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  return (
    <GlowContext.Provider value={position}>
      {children}
    </GlowContext.Provider>
  );
}
