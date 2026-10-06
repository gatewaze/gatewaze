/**
 * Whether the admin is running embedded in a host application.
 *
 * Set by `mount()` and cleared by the handle's `unmount()`, so it reflects the
 * live state rather than "was ever embedded" — the module survives an unmount.
 *
 * Exists so shared components can drop chrome that the host already provides.
 * The host owns the page frame when embedded: it shows its own loading state
 * while the bundle downloads and mounts, so a second full-screen loader from
 * inside the embed reads as a stall rather than progress.
 *
 * Deliberately not read from `__GATEWAZE_CONFIG__`: that global is also set
 * for non-embedded builds by the Vite define rewrite, so it cannot distinguish
 * the two.
 */
let embedded = false;

export function setEmbeddedMode(value: boolean): void {
  embedded = value;
}

export function isEmbedded(): boolean {
  return embedded;
}
