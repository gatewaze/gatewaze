import { useEffect, useState } from "react";

// Local Imports
import { BrandLogo } from "@/components/BrandLogo";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useBrandingLogos } from "@/hooks/useBrandingLogos";

// ----------------------------------------------------------------------

export function SplashScreen() {
  const { ready } = useBrandingLogos();
  const [visible, setVisible] = useState(false);

  // Once branding has resolved, defer one frame so the transition-opacity
  // animation runs (mounting straight at opacity-100 would skip the fade).
  useEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [ready]);

  return (
    <div className="fixed grid h-full w-full place-content-center">
      <div
        className={`transition-opacity duration-500 ease-out ${visible ? "opacity-100" : "opacity-0"}`}
      >
        <BrandLogo type="logotype" variant="dark" className="w-40" />
      </div>
      <div className="mt-4 flex justify-center">
        <LoadingSpinner size="medium" />
      </div>
    </div>
  );
}
