// Import Dependencies
import { useNProgress } from "@tanem/react-nprogress";

// Local Imports
import { useThemeContext } from "@/app/contexts/theme/context";

// ----------------------------------------------------------------------

interface NProgressProps {
  isAnimating: boolean;
}

function NProgress({ isAnimating }: NProgressProps) {
  const { primaryColorScheme: primary, isDark } = useThemeContext();
  const { animationDuration, isFinished, progress } = useNProgress({
    isAnimating,
  });

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 h-0.5 w-full"
      style={{
        zIndex: 9999,
      }}
    >
      {!isFinished && (
        <div
          className="relative h-full"
          style={{
            backgroundColor: isDark ? primary[500] : primary[600],
            width: `${progress * 100}%`,
            transition: `width ${animationDuration}ms ease-out`,
          }}
        >
          <div
            className="absolute right-0 h-full opacity-100"
            style={{
              boxShadow: `0 0 10px ${
                isDark ? primary[500] : primary[600]
              }, 0 0 5px ${isDark ? primary[500] : primary[600]}`,
              transform: "rotate(3deg) translate(0px, -4px)",
              width: 100,
            }}
          />
        </div>
      )}
    </div>
  );
}

NProgress.displayName = "NProgress";

export { NProgress };
