import { useState, useEffect, type CSSProperties } from "react";

type Phase = "idle" | "sliding" | "revealing" | "done";

interface AnimatedLogoProps {
  className?: string;
  variant?: "white" | "black";
  onComplete?: () => void;
}

export function AnimatedLogo({
  className = "",
  variant = "white",
  onComplete,
}: AnimatedLogoProps) {
  const [phase, setPhase] = useState<Phase>("idle");

  const logoSrc = `/theme/gatewaze/logo_${variant}.svg`;

  useEffect(() => {
    // Small delay before starting the slide
    const t1 = setTimeout(() => setPhase("sliding"), 300);
    // After the slide, start revealing other letters
    const t2 = setTimeout(() => setPhase("revealing"), 1200);
    // Mark done after reveal completes
    const t3 = setTimeout(() => {
      setPhase("done");
      onComplete?.();
    }, 1900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onComplete]);

  // G occupies ~first 13% of the SVG width.
  // Clip to show only the G, with a tiny bit of padding to avoid edge artifacts.
  const gClip = "inset(0 85.5% 0 0)";

  const gLayerStyle: CSSProperties = {
    clipPath: gClip,
    transform:
      phase === "idle" ? "translateX(80%)" : "translateX(0)",
    transition: "transform 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
    width: "100%",
    height: "auto",
  };

  const fullLayerStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    opacity: phase === "revealing" || phase === "done" ? 1 : 0,
    transition: "opacity 0.7s ease-out",
    width: "100%",
    height: "auto",
  };

  return (
    <div className={`relative ${className}`} style={{ lineHeight: 0 }}>
      {/* Layer 1: G only, slides from right to its natural position */}
      <img
        src={logoSrc}
        alt=""
        draggable={false}
        style={gLayerStyle}
      />
      {/* Layer 2: Full logotype, fades in once G arrives */}
      <img
        src={logoSrc}
        alt="Gatewaze"
        draggable={false}
        style={fullLayerStyle}
      />
    </div>
  );
}
