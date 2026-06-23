/**
 * Shared sending component — adapter contract.
 *
 * One `<SendingPanel>` serves every email-sending surface (newsletters,
 * broadcasts, event comms) on the uniform "parent content entity → many sends →
 * recipients" model: a parent (newsletter edition / broadcast / event) has many
 * send instances (newsletter_sends / broadcast_sends / email_batch_jobs), each
 * with its own status, schedule, and realtime email log.
 *
 * Each domain implements a `SendingAdapter` that tells the panel which tables to
 * read, how to create/trigger a send, and how its email-details + recipients are
 * edited. Everything else (the composer, scheduling, the realtime log, the
 * timezone breakdown, pause/resume/cancel, test send) is shared.
 */
import type { ReactNode } from 'react';

/** A send instance row, normalised to what the panel renders. */
export interface SendRecord {
  id: string;
  status: string;                 // scheduled | sending | sent | failed | cancelling | cancelled | paused
  subject?: string | null;
  scheduled_at?: string | null;
  delivery_strategy?: string | null;
  total_recipients?: number | null;
  sent_count?: number | null;
  failed_count?: number | null;
  created_at: string;
}

export type ScheduleType = 'immediate' | 'scheduled';
export type DeliveryStrategy = 'global' | 'tz_local' | 'personalised';

/** What the operator picks in the composer for a new send. */
export interface SendComposerConfig {
  scheduleType: ScheduleType;
  scheduledAt: string | null;     // ISO instant when scheduled
  deliveryStrategy: DeliveryStrategy;
  targetLocal: string | null;     // 'HH:MM' local target for staggered sends
  defaultTimezone: string | null;
  excludeSentSendIds: string[];   // prior sends whose sent recipients to skip
}

export interface EmailDetails {
  subject: string;
  preheader: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
}

/**
 * Email details (subject / preheader / from / from-name / reply-to).
 * - Broadcasts + event emails: editable inline in the panel (`editable: true`,
 *   `save` persists to the parent).
 * - Newsletters: newsletter-level — shown read-only with an Edit link to the
 *   newsletter settings (`editable: false`, `editHref`), so one edition can't
 *   silently diverge the From from the rest of the newsletter.
 */
export interface EmailDetailsControl {
  values: EmailDetails;
  editable: boolean;
  editHref?: string;
  editLabel?: string;
  save?: (values: EmailDetails) => Promise<void>;
}

/** Audience summary + how to edit it (newsletter → settings; broadcast/event → inline/href). */
export interface RecipientsControl {
  display: string;                // e.g. 'Test (5,102)'
  editable: boolean;
  editHref?: string;
  editLabel?: string;
  editNode?: ReactNode;           // optional inline editor (broadcast/event audience)
}

export interface SendingAdapter {
  domainKey: 'newsletter' | 'broadcast' | 'event';
  title: string;                  // panel heading, e.g. 'Send Newsletter'
  parentId: string;               // editionId | broadcastId | eventId
  sendsTable: string;             // newsletter_sends | broadcast_sends | email_batch_jobs
  parentFkColumn: string;         // edition_id | broadcast_id | event_id
  logSendIdColumn: string;        // email_send_log.<col> for this domain
  tzBreakdownRpc?: string;        // newsletter_send_timezone_breakdown (others omit)
  /** Edge fn (POST { send_id }) that triggers an immediate send. */
  sendEndpoint: string;

  canSend: boolean;
  canSendReason?: string;         // why sending is blocked (e.g. 'Publish first')

  features: {
    deliveryStrategy: boolean;    // offer global / tz_local / personalised stagger
    excludeSent: boolean;         // offer "exclude already-sent recipients"
  };

  emailDetails: EmailDetailsControl;
  recipients: RecipientsControl;

  /** Create a new send instance from the composer config; returns its id. */
  createSend: (config: SendComposerConfig) => Promise<{ id: string }>;
  /** Re-render + overwrite a send's stored content for not-yet-sent recipients. */
  rerenderContent?: (sendId: string) => Promise<void>;
  /** Send a one-off test to an arbitrary address (also offered, not exclusive to, the newsletter editor). */
  sendTest?: (email: string) => Promise<void>;
}
