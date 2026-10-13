import type { MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowTopRightOnSquareIcon, CheckIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

import { getNavigationIcon } from "@/app/navigation/icons";
import { openHostPath } from "@/utils/openHostPath";
import type { NavHubAccent } from "@gatewaze/shared/modules";
import { accentColors, cardAccent } from "./accents";

export interface NavHubCardTileProps {
  title: string;
  icon?: string;
  eyebrow?: string;
  description?: string;
  tags?: string[];
  accent?: NavHubAccent;
  comingSoon?: boolean;
  /** Position on the page; picks the accent when the card has none. */
  index: number;
  /** Module card: the admin route to open. */
  to?: string;
  /** Custom card: absolute http(s) URL or host path (already validated). */
  url?: string;
  newTab?: boolean;
  /** Render without any link, e.g. as a preview in the Navigation editor. */
  preview?: boolean;
}

/**
 * One card on a module hub page: a coloured left edge, an icon tile, an
 * optional line above the title, tag chips and a short description. The whole
 * card is the link. Coming-soon cards are greyed out and don't link.
 */
export function NavHubCardTile(props: NavHubCardTileProps) {
  const navigate = useNavigate();
  const { title, icon, eyebrow, description, tags = [], comingSoon, index, to, url, newTab, preview } = props;
  const colors = accentColors(cardAccent(props.accent, index));
  const Icon = getNavigationIcon(icon);
  const opensElsewhere = !!url && (newTab || /^https?:/i.test(url));

  const body = (
    <article
      className={clsx(
        "flex h-full flex-col gap-3 rounded-lg border border-[var(--gray-a5)] bg-[var(--color-panel-solid)] p-5 transition-shadow",
        comingSoon ? "opacity-60" : "group-hover:shadow-md group-focus-visible:shadow-md",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: colors.edge }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-lg"
          style={{ background: colors.tileBg, color: colors.tileFg }}
        >
          {Icon && <Icon className="size-6" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="truncate text-xs text-[var(--gray-10)]">{eyebrow}</p>}
          <h3 className="text-base font-semibold leading-snug text-[var(--gray-12)]">{title}</h3>
        </div>
        {opensElsewhere && !comingSoon && (
          <ArrowTopRightOnSquareIcon className="size-4 shrink-0 text-[var(--gray-9)]" aria-label="Opens elsewhere" />
        )}
      </div>
      {(tags.length > 0 || comingSoon) && (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag}>
              {/* A tag starting with ✓ shows a tick, e.g. "✓ v1 generated". */}
              {tag.startsWith("✓") ? (
                <Chip>
                  <CheckIcon className="size-3.5" aria-hidden />
                  {tag.slice(1).trim()}
                </Chip>
              ) : (
                <Chip>{tag}</Chip>
              )}
            </li>
          ))}
          {comingSoon && (
            <li>
              <Chip muted>Coming soon</Chip>
            </li>
          )}
        </ul>
      )}
      {description && <p className="line-clamp-3 text-sm text-[var(--gray-11)]">{description}</p>}
    </article>
  );

  const wrapper = "group block h-full rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)]";

  if (preview || comingSoon) {
    return (
      <div className="h-full" aria-disabled={comingSoon || undefined}>
        {body}
      </div>
    );
  }

  if (to) {
    return (
      <Link to={to} className={wrapper}>
        {body}
      </Link>
    );
  }

  if (url) {
    const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
      // A host path opens in the host's router. Leave modified clicks and
      // new-tab links to the browser.
      if (newTab || !url.startsWith("/") || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      e.preventDefault();
      openHostPath(url, navigate);
    };
    return (
      <a
        href={url}
        onClick={onClick}
        className={wrapper}
        {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noreferrer" })}
      >
        {body}
      </a>
    );
  }

  return <div className="h-full">{body}</div>;
}

function Chip({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs",
        muted
          ? "border-transparent bg-[var(--gray-a3)] text-[var(--gray-10)]"
          : "border-[var(--gray-a6)] text-[var(--gray-12)]",
      )}
    >
      {children}
    </span>
  );
}
