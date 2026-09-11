/**
 * Embed-only stand-in for `@radix-ui/themes` that defaults every portalled component's
 * `container` prop to the host's portal element.
 *
 * Why this exists
 * ---------------
 * Radix Themes renders overlays through `Portal container={container}`, and when `container` is
 * undefined the underlying primitive falls back to `document.body`. In the standalone admin that
 * is harmless — the app owns the whole document. Inside a host it is not: the embed's stylesheet
 * is scoped to the host's mount containers, so an overlay that lands directly in the host's
 * `<body>` matches none of it and renders with no panel, no sizing and full-size icons. That is
 * exactly what the row action menus looked like in LFX.
 *
 * `GwHostContext.portalContainer` already exists for this, and was documented as "where Radix
 * portals render" — it was simply never read. This file implements it.
 *
 * Why an alias rather than editing call sites
 * -------------------------------------------
 * The portalled components are imported straight from `@radix-ui/themes` by shared admin
 * components and by every module repo. Passing `container` at each of those call sites would mean
 * editing files the standalone app also ships, for a problem only the embed has. Aliasing instead
 * keeps the change inside the embed build (see the `resolve.alias` entry in vite.embed.config.ts),
 * so Gatewaze standalone is bit-for-bit unaffected, and code written later gets the behaviour
 * without knowing this file exists.
 *
 * The deep import below is deliberate: the alias matches the bare specifier exactly, so importing
 * the package's own entry by path is what keeps this module from resolving to itself.
 */
import { forwardRef, type ComponentPropsWithoutRef, type ElementType } from 'react';
import * as RadixThemes from '@radix-ui/themes/dist/esm/index.js';

import { getEmbedPortalContainer } from './portalContainer';

export * from '@radix-ui/themes/dist/esm/index.js';

/**
 * Wrap one portalled component so it picks up the host container by default.
 *
 * `container` is spread from props *after* the default, so an explicit `container` on a call site
 * still wins — including an explicit `undefined`, which is the documented way to opt back out to
 * Radix's own default.
 */
function withHostPortalContainer<T extends ElementType>(Component: T, displayName: string) {
  const Wrapped = forwardRef<unknown, ComponentPropsWithoutRef<T>>((props, ref) => {
    const container = getEmbedPortalContainer() ?? undefined;
    const Rendered = Component as ElementType;
    return <Rendered container={container} {...props} ref={ref} />;
  });
  Wrapped.displayName = displayName;
  return Wrapped as unknown as T;
}

/*
 * Explicit exports shadow the `export *` above for these names, so importers get the patched
 * namespaces and everything else untouched.
 *
 * The list is every Radix Themes component that accepts `container` in 3.3.0 — verified against
 * the package's own dist rather than its docs. Each namespace is rebuilt as a plain object because
 * module namespace objects are frozen and cannot be patched in place.
 */
export const DropdownMenu = {
  ...RadixThemes.DropdownMenu,
  Content: withHostPortalContainer(RadixThemes.DropdownMenu.Content, 'DropdownMenu.Content'),
  SubContent: withHostPortalContainer(RadixThemes.DropdownMenu.SubContent, 'DropdownMenu.SubContent'),
};

export const ContextMenu = {
  ...RadixThemes.ContextMenu,
  Content: withHostPortalContainer(RadixThemes.ContextMenu.Content, 'ContextMenu.Content'),
  SubContent: withHostPortalContainer(RadixThemes.ContextMenu.SubContent, 'ContextMenu.SubContent'),
};

export const Dialog = {
  ...RadixThemes.Dialog,
  Content: withHostPortalContainer(RadixThemes.Dialog.Content, 'Dialog.Content'),
};

export const AlertDialog = {
  ...RadixThemes.AlertDialog,
  Content: withHostPortalContainer(RadixThemes.AlertDialog.Content, 'AlertDialog.Content'),
};

export const Popover = {
  ...RadixThemes.Popover,
  Content: withHostPortalContainer(RadixThemes.Popover.Content, 'Popover.Content'),
};

export const HoverCard = {
  ...RadixThemes.HoverCard,
  Content: withHostPortalContainer(RadixThemes.HoverCard.Content, 'HoverCard.Content'),
};

export const Select = {
  ...RadixThemes.Select,
  Content: withHostPortalContainer(RadixThemes.Select.Content, 'Select.Content'),
};

/** Tooltip takes `container` on the root component itself, not on a `.Content` child. */
export const Tooltip = withHostPortalContainer(RadixThemes.Tooltip, 'Tooltip');
