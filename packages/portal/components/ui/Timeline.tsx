/**
 * Timeline — vertical timeline layout (double-circle node + dotted connector) used by the public
 * Events view to group event cards by date. Presentational + composable: pass groups, each with a
 * label and arbitrary content. The connector is drawn for every group except the last.
 */
import type { ReactNode } from 'react'

export interface TimelineGroup {
  /** Stable key (e.g. the ISO date). */
  key: string
  /** Rendered date/label header for the group. */
  label: ReactNode
  content: ReactNode
}

export interface TimelineProps {
  groups: TimelineGroup[]
  className?: string
}

export function Timeline({ groups, className }: TimelineProps) {
  return (
    <div className={`pub-tl ${className ?? ''}`}>
      {groups.map((group, i) => (
        <div key={group.key} className="pub-tl-group">
          <div className="pub-tl-rail" aria-hidden>
            <span className="pub-tl-node" />
            {i < groups.length - 1 && <span className="pub-tl-line" />}
          </div>
          <div className="pub-tl-body">
            <div className="pub-tl-date">{group.label}</div>
            <div className="pub-tl-items">{group.content}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default Timeline
