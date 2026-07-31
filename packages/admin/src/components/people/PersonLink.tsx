import { useNavigate } from 'react-router';

interface PersonLinkProps {
  /** Resolved person id; when absent the label renders as plain text. */
  personId?: string | null;
  /** Text to display (a name or email). */
  label: string;
  /** Extra classes for sizing/weight — colour is applied by this component. */
  className?: string;
  title?: string;
}

/**
 * Renders a person's name/email. When a `personId` is known it becomes a link
 * to that person's detail page (`/people/:id`); otherwise it's plain text.
 * Safe to use inside a clickable row — clicks/keys stop propagation so the row's
 * own handler (e.g. expand/collapse) doesn't also fire.
 */
export function PersonLink({ personId, label, className = '', title }: PersonLinkProps) {
  const navigate = useNavigate();

  if (!personId) {
    return (
      <span className={`${className} text-[var(--gray-12)]`} title={title}>
        {label}
      </span>
    );
  }

  const go = () => navigate(`/people/${personId}`);
  return (
    <span
      role="link"
      tabIndex={0}
      title={title || 'View person profile'}
      onClick={(e) => {
        e.stopPropagation();
        go();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          go();
        }
      }}
      className={`${className} cursor-pointer text-[var(--accent-11)] hover:underline underline-offset-2`}
    >
      {label}
    </span>
  );
}

export default PersonLink;
