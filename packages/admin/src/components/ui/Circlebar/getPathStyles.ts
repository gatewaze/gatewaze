export function getPathStyles(
  value: number,
  offsetDegree: number | undefined,
  gapDegree: number,
  strokeWidth: number,
): { pathString: string; pathStyle: React.CSSProperties } {
  const radius = 50;
  const beginPositionX = 0;
  const beginPositionY = radius;
  const endPositionX = 0;
  const endPositionY = 2 * radius;
  const centerX = 50 + strokeWidth / 2;

  const pathString = `M ${centerX},${centerX} m ${beginPositionX},${beginPositionY}
      a ${radius},${radius} 0 1 1 ${endPositionX},${-endPositionY}
      a ${radius},${radius} 0 1 1 ${-endPositionX},${endPositionY}`;

  const len = Math.PI * 2 * radius;

  const pathStyle: React.CSSProperties = {
    strokeDasharray: `${(value / 100) * (len - gapDegree)}px ${100 * 8}px`,
    strokeDashoffset: `-${gapDegree / 2}px`,
    transformOrigin: offsetDegree ? "center" : undefined,
    transform: offsetDegree ? `rotate(${offsetDegree}deg)` : undefined,
  };

  return { pathString, pathStyle };
}
