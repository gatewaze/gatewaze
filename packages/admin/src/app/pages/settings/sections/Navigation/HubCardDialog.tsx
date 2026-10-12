import { useMemo, useState } from "react";
import clsx from "clsx";

import { NAV_HUB_ACCENTS } from "@gatewaze/shared";
import type { NavHubAccent, NavLayoutItem } from "@gatewaze/shared/modules";
import { getNavigationIcon } from "@/app/navigation/icons";
import { NavHubCardTile } from "@/components/shared/hubCard/NavHubCardTile";
import { ACCENT_LABELS, accentColors } from "@/components/shared/hubCard/accents";
import { IconPicker } from "./IconPicker";
import { compactCard, hubCardError, isCustomCard } from "./editorModel";

const inputClass =
  "w-full rounded-md border border-[var(--gray-a6)] bg-transparent px-2 py-1.5 text-sm text-[var(--gray-12)] placeholder:text-[var(--gray-9)]";

/**
 * Edit one hub card. Module cards inherit their title, icon and description
 * from the module, so those fields are optional overrides; custom cards need a
 * title and a link (or "coming soon").
 */
export function HubCardDialog({
  card,
  index,
  defaults,
  onSave,
  onClose,
}: {
  card: NavLayoutItem;
  /** The card's position, for the preview's automatic accent. */
  index: number;
  /** What a module card shows when a field is left blank. */
  defaults: { title?: string; icon?: string; description?: string };
  onSave: (card: NavLayoutItem) => void;
  onClose: () => void;
}) {
  const custom = isCustomCard(card);
  const [draft, setDraft] = useState<NavLayoutItem>(card);
  const [tagsText, setTagsText] = useState((card.tags ?? []).join(", "));
  const [pickingIcon, setPickingIcon] = useState(false);

  const result = useMemo(
    () =>
      compactCard({
        ...draft,
        tags: tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 5),
      }),
    [draft, tagsText],
  );
  const error = hubCardError(result);
  const set = (patch: Partial<NavLayoutItem>) => setDraft((d) => ({ ...d, ...patch }));
  const iconName = draft.icon || defaults.icon;
  const Icon = getNavigationIcon(iconName);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="hub-card-dialog-title"
          className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-[var(--color-panel-solid)] shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="hub-card-dialog-title" className="border-b border-[var(--gray-a5)] px-4 py-3 text-sm font-semibold text-[var(--gray-12)]">
            {custom ? (card.label ? "Edit custom card" : "Add a custom card") : "Edit card"}
          </h3>

          <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-4 md:grid-cols-2">
            <div className="space-y-3">
              <Field label={custom ? "Title" : "Title (optional)"}>
                <input
                  value={draft.label ?? ""}
                  onChange={(e) => set({ label: e.target.value })}
                  placeholder={defaults.title ?? "e.g. Events"}
                  maxLength={200}
                  className={inputClass}
                  autoFocus
                />
              </Field>

              {custom && (
                <>
                  <Field
                    label="Link"
                    help="A full address such as https://example.org, or a path such as /foundation/events. Inside LFX, a path opens that page in LFX."
                  >
                    <input
                      value={draft.url ?? ""}
                      onChange={(e) => set({ url: e.target.value })}
                      placeholder="https://… or /path"
                      maxLength={2000}
                      className={inputClass}
                      inputMode="url"
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-[var(--gray-12)]">
                    <input type="checkbox" checked={draft.newTab === true} onChange={(e) => set({ newTab: e.target.checked })} />
                    Open in a new tab
                  </label>
                </>
              )}

              <Field label="Line above the title (optional)" help='e.g. "Agent 1"'>
                <input
                  value={draft.eyebrow ?? ""}
                  onChange={(e) => set({ eyebrow: e.target.value })}
                  maxLength={60}
                  className={inputClass}
                />
              </Field>

              <Field label="Description (optional)">
                <textarea
                  value={draft.description ?? ""}
                  onChange={(e) => set({ description: e.target.value })}
                  placeholder={defaults.description}
                  maxLength={300}
                  rows={3}
                  className={inputClass}
                />
              </Field>

              <Field label="Tags (optional)" help="Separate with commas, up to 5. Start a tag with ✓ to show a tick.">
                <input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="e.g. Brand, Identity"
                  className={inputClass}
                />
              </Field>

              <div className="flex flex-wrap items-start gap-6">
                <Field label="Icon">
                  <button
                    type="button"
                    onClick={() => setPickingIcon(true)}
                    className="flex items-center gap-2 rounded-md border border-[var(--gray-a6)] px-2 py-1.5 text-sm text-[var(--gray-12)] hover:border-[var(--accent-8)]"
                  >
                    {Icon ? <Icon className="size-5" aria-hidden /> : <span className="text-[var(--gray-9)]">None</span>}
                    <span className="text-xs text-[var(--gray-10)]">Change</span>
                  </button>
                </Field>

                <Field label="Colour">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => set({ accent: undefined })}
                      className={clsx(
                        "rounded-md border px-2 py-1 text-xs",
                        !draft.accent ? "border-[var(--accent-8)] text-[var(--accent-11)]" : "border-[var(--gray-a6)] text-[var(--gray-11)]",
                      )}
                    >
                      Automatic
                    </button>
                    {NAV_HUB_ACCENTS.map((accent: NavHubAccent) => (
                      <button
                        key={accent}
                        type="button"
                        title={ACCENT_LABELS[accent]}
                        aria-label={ACCENT_LABELS[accent]}
                        aria-pressed={draft.accent === accent}
                        onClick={() => set({ accent })}
                        className={clsx(
                          "size-6 rounded-full border-2",
                          draft.accent === accent ? "border-[var(--gray-12)]" : "border-transparent",
                        )}
                        style={{ background: accentColors(accent).edge }}
                      />
                    ))}
                  </div>
                </Field>
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--gray-12)]">
                <input type="checkbox" checked={draft.comingSoon === true} onChange={(e) => set({ comingSoon: e.target.checked })} />
                Coming soon (shown greyed out, not clickable)
              </label>
            </div>

            <div className="self-start">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--gray-10)]">Preview</p>
              <NavHubCardTile
                preview
                index={index}
                title={result.label ?? defaults.title ?? "Untitled"}
                icon={iconName}
                eyebrow={result.eyebrow}
                description={result.description ?? defaults.description}
                tags={result.tags}
                accent={result.accent}
                comingSoon={result.comingSoon}
                url={result.url}
                newTab={result.newTab}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[var(--gray-a5)] px-4 py-3">
            {error && <p className="mr-auto text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-[var(--gray-11)] hover:bg-[var(--gray-a3)]">
              Cancel
            </button>
            <button
              type="button"
              disabled={error !== null}
              onClick={() => onSave(result)}
              className="rounded-md bg-[var(--accent-9)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-10)] disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* Outside the dialog's backdrop, so a click on the picker's own backdrop
          closes only the picker, not the dialog and its unsaved draft. */}
      {pickingIcon && (
        <IconPicker
          value={draft.icon}
          onSelect={(icon) => {
            set({ icon });
            setPickingIcon(false);
          }}
          onClose={() => setPickingIcon(false)}
        />
      )}
    </>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs text-[var(--gray-11)]">{label}</p>
      {children}
      {help && <p className="mt-1 text-xs text-[var(--gray-9)]">{help}</p>}
    </div>
  );
}
