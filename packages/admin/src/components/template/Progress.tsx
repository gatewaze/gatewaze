// Import Dependencies
import { useNavigation } from "react-router";

// Local Imports
import { NProgress } from "@/components/shared/NProgress";

// ----------------------------------------------------------------------

export function Progress() {
  const navigation = useNavigation();

  const isLoading: boolean =
    navigation.state === "loading" &&
    navigation.formData == null &&
    !!navigation.location?.pathname;

  return <NProgress isAnimating={isLoading} />;
}
