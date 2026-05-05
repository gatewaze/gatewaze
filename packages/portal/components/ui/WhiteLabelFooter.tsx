interface Props {
  className?: string
}

// Custom-domain pages don't show platform footer links (Privacy, Terms,
// Do-Not-Sell, Powered by Gatewaze). They're hidden so a white-labelled
// event reads as the brand's own page rather than a Gatewaze surface.
// Component intentionally returns null; the parent layout still chooses
// between Footer and WhiteLabelFooter so the slot stays present if we
// later want to put domain-specific links here.
export function WhiteLabelFooter(_props: Props) {
  return null
}
