import { getEnabledModules } from './enabledModules'

/**
 * Module ids that are actually shown in the public site navigation — i.e.
 * enabled, registered a `portal_nav` entry, and NOT hidden via the
 * `portal_nav_overrides.hidden` flag. This is the rail the public site renders
 * (minus the synthetic "home").
 *
 * Hiding a module's menu item is how an operator marks its content "not ready
 * for public consumption", so anything amplifying content to the open web
 * (feeds in particular) must gate on THIS set, not merely on `enabled`.
 */
export async function getNavVisibleModuleIds(): Promise<Set<string>> {
  const state = await getEnabledModules()
  return new Set(state.railItems.filter((r) => r.moduleId !== 'home').map((r) => r.moduleId))
}
