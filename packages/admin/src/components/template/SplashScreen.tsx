// Local Imports
import { BrandLogo } from "@/components/BrandLogo";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

// ----------------------------------------------------------------------

export function SplashScreen() {
  return (
    <>
      <div className="fixed grid h-full w-full place-content-center">
        <BrandLogo type="logo" className="w-40" />
        <div className="mt-4 flex justify-center">
          <LoadingSpinner size="medium" />
        </div>
      </div>
    </>
  );
}
