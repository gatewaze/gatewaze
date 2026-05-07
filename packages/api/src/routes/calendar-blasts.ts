// Per spec-calendars-microsites §8.1 — admin REST surface for the
// Messaging tab. Until now the admin UI talked direct browser→Supabase
// via the calendarBlastService in premium-gatewaze-modules. That works
// (RLS gates everything) but it doesn't give us a REST contract an
// external integrator can hit, and per-route metrics / rate limits
// have to live inside the SDK rather than at the edge.
//
// All handlers run under the caller's JWT via getRequestSupabase(req),
// so RLS (`can_admin_calendar` + permission_level checks) is the
// authorization gate — same model as routes/calendars.ts. Validation +
// rate limits + error envelope are the value-add this layer brings.
//
// Per §19.2: audience/preview is 10/min/admin, blasts POST is 1/min/
// calendar — the in-process rate-limiter buckets are per-user, which
// is the closest practical proxy (most calendars have a small admin
// set; we can split per-calendar buckets later if multiple admins
// share a calendar enough to matter).

import { createHash } from 'node:crypto';
import { getRequestSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';
import { ValidationError, NotFoundError, ApiError } from '../lib/errors.js';
import { rateLimiter } from '../lib/rate-limiter.js';
import { logger } from '../lib/logger.js';

export const calendarBlastsRouter = labeledRouter('jwt');
calendarBlastsRouter.use(requireJwt());

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------

const audiencePreviewRateLimiter = rateLimiter({
  perUserRate: 10,
  windowSecs: 60,
  perUserConcurrency: 2,
  globalConcurrency: 20,
  bucket: 'cal-audience-preview',
});

const blastSendRateLimiter = rateLimiter({
  perUserRate: 1,
  windowSecs: 60,
  perUserConcurrency: 1,
  globalConcurrency: 5,
  bucket: 'cal-blast-send',
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_CHANNELS = new Set(['email', 'sms', 'whatsapp'] as const);
type Channel = 'email' | 'sms' | 'whatsapp';

const VALID_MODES = new Set(['any_of', 'all_of', 'none_of']);
const VALID_KINDS = new Set(['registered', 'attended']);
const VALID_SCOPES = new Set(['specific', 'any_past_calendar_event']);

interface AudienceParticipationGroup {
  mode: string;
  kind: string;
  scope?: string;
  event_ids?: string[];
}

interface AudienceFilter {
  membership_types?: string[];
  membership_status?: string[];
  require_email_notifications?: boolean;
  event_participation?: AudienceParticipationGroup[];
}

function asChannel(v: unknown): Channel {
  if (typeof v === 'string' && (VALID_CHANNELS as Set<string>).has(v)) return v as Channel;
  throw new ValidationError('channel must be one of email, sms, whatsapp', {
    field: 'channel',
  });
}

// Accept and normalise the audience filter — reject unknown shapes early
// rather than passing junk to the resolver RPC (which would either
// silently ignore or throw a less actionable error).
function normaliseFilter(raw: unknown): AudienceFilter {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('filter must be an object', { field: 'filter' });
  }
  const f = raw as Record<string, unknown>;
  const out: AudienceFilter = {};

  if (f.membership_types !== undefined) {
    if (!Array.isArray(f.membership_types) || !f.membership_types.every((s) => typeof s === 'string')) {
      throw new ValidationError('membership_types must be an array of strings', {
        field: 'filter.membership_types',
      });
    }
    out.membership_types = f.membership_types as string[];
  }

  if (f.membership_status !== undefined) {
    if (!Array.isArray(f.membership_status) || !f.membership_status.every((s) => typeof s === 'string')) {
      throw new ValidationError('membership_status must be an array of strings', {
        field: 'filter.membership_status',
      });
    }
    out.membership_status = f.membership_status as string[];
  }

  if (f.require_email_notifications !== undefined) {
    if (typeof f.require_email_notifications !== 'boolean') {
      throw new ValidationError('require_email_notifications must be boolean', {
        field: 'filter.require_email_notifications',
      });
    }
    out.require_email_notifications = f.require_email_notifications;
  }

  if (f.event_participation !== undefined) {
    if (!Array.isArray(f.event_participation)) {
      throw new ValidationError('event_participation must be an array', {
        field: 'filter.event_participation',
      });
    }
    const groups: AudienceParticipationGroup[] = [];
    for (const [i, g] of f.event_participation.entries()) {
      if (!g || typeof g !== 'object' || Array.isArray(g)) {
        throw new ValidationError(`event_participation[${i}] must be an object`, {
          field: `filter.event_participation[${i}]`,
        });
      }
      const grp = g as Record<string, unknown>;
      if (typeof grp.mode !== 'string' || !VALID_MODES.has(grp.mode)) {
        throw new ValidationError(`event_participation[${i}].mode invalid`, {
          field: `filter.event_participation[${i}].mode`,
          allowed: Array.from(VALID_MODES),
        });
      }
      if (typeof grp.kind !== 'string' || !VALID_KINDS.has(grp.kind)) {
        throw new ValidationError(`event_participation[${i}].kind invalid`, {
          field: `filter.event_participation[${i}].kind`,
          allowed: Array.from(VALID_KINDS),
        });
      }
      if (grp.scope !== undefined && (typeof grp.scope !== 'string' || !VALID_SCOPES.has(grp.scope))) {
        throw new ValidationError(`event_participation[${i}].scope invalid`, {
          field: `filter.event_participation[${i}].scope`,
          allowed: Array.from(VALID_SCOPES),
        });
      }
      if (grp.event_ids !== undefined && (!Array.isArray(grp.event_ids) || !grp.event_ids.every((s) => typeof s === 'string'))) {
        throw new ValidationError(`event_participation[${i}].event_ids must be string[]`, {
          field: `filter.event_participation[${i}].event_ids`,
        });
      }
      groups.push({
        mode: grp.mode,
        kind: grp.kind,
        scope: grp.scope as string | undefined,
        event_ids: (grp.event_ids as string[] | undefined) ?? [],
      });
    }
    out.event_participation = groups;
  }

  return out;
}

// Stable hash of the canonicalised filter — `filter_hash` in the API
// contract per spec §17.3. JSON.stringify isn't deterministic on object
// key order, so we sort keys recursively first. Used for dedup + audit;
// downstream consumers can compare two preview hashes to know whether
// a re-resolve is needed.
function hashFilter(filter: AudienceFilter): string {
  const canonical = JSON.stringify(filter, Object.keys(filter).sort());
  return 'sha256-' + createHash('sha256').update(canonical).digest('hex');
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 1) return email;
  const local = email.substring(0, at);
  const masked =
    local.length <= 2 ? local[0] + '***' : local[0] + '***' + local[local.length - 1];
  return masked + email.substring(at);
}

// Per spec §18.5: "row-level cap at 100k recipients per blast" — refuse
// to insert a blast row for an audience this large; admin needs to
// narrow the filter. This is independent of the per-recipient send
// pacing in the worker.
const MAX_RECIPIENTS_PER_BLAST = 100_000;

// ---------------------------------------------------------------------------
// POST /api/calendars/:id/audience/preview
// ---------------------------------------------------------------------------

calendarBlastsRouter.post('/:id/audience/preview', audiencePreviewRateLimiter, async (req, res, next) => {
  try {
    const calendarId = req.params.id;
    const body = (req.body ?? {}) as { channel?: unknown; filter?: unknown };
    const channel = body.channel === undefined ? 'email' : asChannel(body.channel);
    const filter = normaliseFilter(body.filter);

    const supabase = getRequestSupabase(req);
    const { data, error } = await supabase.rpc('resolve_calendar_audience', {
      p_calendar_id: calendarId,
      p_filter: filter,
      p_channel: channel,
    });
    if (error) {
      // RLS denial / missing FK shows up here. The user-scoped client
      // ensures only an admin can resolve the audience — so a thrown
      // error is the wrong path; surface it as 403 if it's an auth
      // failure (RLS) and 500 otherwise.
      const code = (error as { code?: string }).code ?? '';
      if (code === '42501') {
        throw new ApiError(403, 'forbidden', 'Not an admin of this calendar');
      }
      throw new ApiError(500, 'internal_error', error.message ?? 'Audience resolution failed');
    }

    const rows = (data ?? []) as Array<{
      member_id: string;
      person_id: string | null;
      email: string | null;
      phone: string | null;
      membership_type: string | null;
    }>;

    const sample = rows.slice(0, 5).map((r) => ({
      person_id: r.person_id,
      name: null,
      email_masked: maskEmail(r.email),
      membership_type: r.membership_type,
    }));

    res.json({
      count: rows.length,
      sample,
      filter_hash: hashFilter(filter),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/calendars/:id/blasts — create draft, schedule, or send-now
// ---------------------------------------------------------------------------

interface CreateBlastBody {
  channel?: unknown;
  subject?: unknown;
  body_template?: unknown;
  audience_filter?: unknown;
  schedule?: unknown;
}

calendarBlastsRouter.post('/:id/blasts', blastSendRateLimiter, async (req, res, next) => {
  try {
    const calendarId = req.params.id;
    const body = (req.body ?? {}) as CreateBlastBody;
    const channel = asChannel(body.channel);
    const audience = normaliseFilter(body.audience_filter);

    const subject = typeof body.subject === 'string' ? body.subject : null;
    const bodyTemplate = typeof body.body_template === 'string' ? body.body_template : null;

    let scheduleAt: string | null = null;
    if (body.schedule != null) {
      if (typeof body.schedule !== 'object' || Array.isArray(body.schedule)) {
        throw new ValidationError('schedule must be an object or null', { field: 'schedule' });
      }
      const sched = body.schedule as { send_at?: unknown };
      if (sched.send_at != null) {
        if (typeof sched.send_at !== 'string' || isNaN(Date.parse(sched.send_at))) {
          throw new ValidationError('schedule.send_at must be an ISO timestamp or null', {
            field: 'schedule.send_at',
          });
        }
        scheduleAt = sched.send_at;
      }
    }

    // Per §17.4: email blasts must have a subject; SMS/WhatsApp need
    // a body. Validate before resolving the audience (cheap upfront).
    if (channel === 'email' && (!subject || !bodyTemplate)) {
      throw new ValidationError('email blasts require subject and body_template', {
        missing_fields: [!subject && 'subject', !bodyTemplate && 'body_template'].filter(Boolean),
      });
    }
    if ((channel === 'sms' || channel === 'whatsapp') && !bodyTemplate) {
      throw new ValidationError(`${channel} blasts require body_template`, { missing_fields: ['body_template'] });
    }

    const supabase = getRequestSupabase(req);

    // Resolve audience for recipient_count snapshot (per §7.4 the row
    // captures recipient_count at create time so the history view
    // doesn't have to re-resolve when admins ask "how many did this
    // reach?").
    const { data: audData, error: audErr } = await supabase.rpc('resolve_calendar_audience', {
      p_calendar_id: calendarId,
      p_filter: audience,
      p_channel: channel,
    });
    if (audErr) {
      const code = (audErr as { code?: string }).code ?? '';
      if (code === '42501') throw new ApiError(403, 'forbidden', 'Not an admin of this calendar');
      throw new ApiError(500, 'internal_error', audErr.message ?? 'Audience resolution failed');
    }
    const recipientCount = (audData ?? []).length;

    if (recipientCount === 0) {
      // Surface the spec'd 422 BLAST_VALIDATION shape via the standard
      // envelope — code is the canonical machine-readable label, the
      // count goes in details so the UI can show "0 recipients" without
      // string-parsing the message.
      throw new ApiError(422, 'validation_failed', 'Audience resolves to zero recipients.', {
        recipient_count: 0,
      });
    }
    if (recipientCount > MAX_RECIPIENTS_PER_BLAST) {
      throw new ApiError(422, 'validation_failed', `Audience exceeds the ${MAX_RECIPIENTS_PER_BLAST.toLocaleString()} recipient cap. Narrow the filter.`, {
        recipient_count: recipientCount,
        cap: MAX_RECIPIENTS_PER_BLAST,
      });
    }

    // status mapping: scheduled → DB stays scheduled; send-now email →
    // immediately bumps to 'sending' once the email_batch_jobs row is
    // queued; send-now sms/whatsapp → set scheduled_at=now() so the
    // cron picks up next tick (the per-recipient loop runs server-side
    // via dispatchPerRecipient, never the user's session).
    const isSendNow = scheduleAt === null;
    const initialStatus = isSendNow ? 'sending' : 'scheduled';
    const initialScheduledAt = isSendNow ? new Date().toISOString() : scheduleAt;

    const { data: blast, error: insErr } = await supabase
      .from('calendars_blasts')
      .insert({
        calendar_id: calendarId,
        created_by: req.userId,
        channel,
        subject,
        body_template: bodyTemplate,
        audience_filter: audience,
        recipient_count: recipientCount,
        status: initialStatus,
        scheduled_at: initialScheduledAt,
      })
      .select()
      .single();

    if (insErr || !blast) {
      const code = (insErr as { code?: string } | null)?.code ?? '';
      if (code === '42501') throw new ApiError(403, 'forbidden', 'Not authorised to create blasts on this calendar');
      throw new ApiError(500, 'internal_error', insErr?.message ?? 'Blast insert failed');
    }
    const blastRow = blast as { id: string; calendar_id: string; channel: Channel; subject: string | null; body_template: string | null };

    // For send-now email, queue the email_batch_jobs row and invoke
    // email-batch-send. SMS/WhatsApp are picked up by the next cron
    // tick (status='scheduled' was already set above with scheduled_at
    // set to now()-ish).
    let finalStatus = initialStatus;
    let emailBatchJobId: string | null = null;

    if (isSendNow && channel === 'email') {
      const jobInsert = await supabase
        .from('email_batch_jobs')
        .insert({
          email_type: 'calendar_blast',
          source_type: 'calendar',
          source_id: calendarId,
          subject_template: subject ?? '',
          content_template: bodyTemplate ?? '',
          status: 'pending',
          total_recipients: recipientCount,
          config: { blast_id: blastRow.id, audience_filter: audience },
        })
        .select('id')
        .single();
      if (jobInsert.error || !jobInsert.data) {
        // Roll back the blast to 'failed' rather than leaving it
        // dangling in 'sending' — the admin needs a clear signal that
        // the send didn't queue.
        await supabase.from('calendars_blasts').update({ status: 'failed' }).eq('id', blastRow.id);
        throw new ApiError(500, 'internal_error', jobInsert.error?.message ?? 'Failed to queue email batch job');
      }
      emailBatchJobId = (jobInsert.data as { id: string }).id;

      await supabase
        .from('calendars_blasts')
        .update({ email_batch_job_id: emailBatchJobId })
        .eq('id', blastRow.id);

      // The functions.invoke uses the user-scoped JWT — the function
      // verifies it server-side. If invoke fails (network, function
      // missing), mark the blast failed so the UI doesn't show a
      // permanently-stuck 'sending'.
      const { error: invokeErr } = await supabase.functions.invoke('email-batch-send', {
        body: { jobId: emailBatchJobId },
      });
      if (invokeErr) {
        await supabase.from('calendars_blasts').update({ status: 'failed' }).eq('id', blastRow.id);
        throw new ApiError(500, 'internal_error', invokeErr.message ?? 'email-batch-send invoke failed');
      }

      finalStatus = 'sending';
    } else if (isSendNow) {
      // SMS / WhatsApp send-now → flip to 'scheduled' so cron picks
      // up. We left status='sending' from the insert; correct it.
      await supabase
        .from('calendars_blasts')
        .update({ status: 'scheduled' })
        .eq('id', blastRow.id);
      finalStatus = 'scheduled';
    }

    res.status(201).json({
      blast_id: blastRow.id,
      status: finalStatus,
      recipient_count: recipientCount,
      ...(emailBatchJobId ? { email_batch_job_id: emailBatchJobId } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/calendars/:id/blasts — history
// ---------------------------------------------------------------------------

calendarBlastsRouter.get('/:id/blasts', async (req, res, next) => {
  try {
    const calendarId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const supabase = getRequestSupabase(req);
    const { data, error, count } = await supabase
      .from('calendars_blasts')
      .select('*', { count: 'exact' })
      .eq('calendar_id', calendarId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ err: error }, 'failed to list calendar blasts');
      throw new ApiError(500, 'internal_error', error.message);
    }

    res.json({
      blasts: data ?? [],
      total: count ?? (data?.length ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/calendars/:id/blasts/:blastId — detail + delivery log
// ---------------------------------------------------------------------------

calendarBlastsRouter.get('/:id/blasts/:blastId', async (req, res, next) => {
  try {
    const { id: calendarId, blastId } = req.params;
    const limit = Math.min(parseInt(req.query.recipient_limit as string) || 200, 1000);

    const supabase = getRequestSupabase(req);
    const blastRes = await supabase
      .from('calendars_blasts')
      .select('*')
      .eq('id', blastId)
      .eq('calendar_id', calendarId)
      .maybeSingle();

    if (blastRes.error) {
      throw new ApiError(500, 'internal_error', blastRes.error.message);
    }
    if (!blastRes.data) throw new NotFoundError('Blast not found');

    const blast = blastRes.data as {
      id: string;
      channel: Channel;
      email_batch_job_id: string | null;
    };

    let recipients: unknown[] = [];
    if (blast.channel === 'email' && blast.email_batch_job_id) {
      const logRes = await supabase
        .from('email_send_log')
        .select('id, recipient_email, status, sent_at, failure_error, created_at')
        .eq('batch_job_id', blast.email_batch_job_id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!logRes.error && Array.isArray(logRes.data)) {
        recipients = logRes.data;
      }
    }

    res.json({ blast: blastRes.data, recipients });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/calendars/:id/blasts/:blastId/cancel
// ---------------------------------------------------------------------------

calendarBlastsRouter.post('/:id/blasts/:blastId/cancel', async (req, res, next) => {
  try {
    const { id: calendarId, blastId } = req.params;
    const supabase = getRequestSupabase(req);

    // Compare-and-swap: only cancel if the row is in a cancellable
    // status. Without the .in() guard, calling cancel on a 'sent'
    // blast would silently no-op the status (still cancellable per
    // RLS) and confuse the admin.
    const { data, error } = await supabase
      .from('calendars_blasts')
      .update({ status: 'cancelled' })
      .eq('id', blastId)
      .eq('calendar_id', calendarId)
      .in('status', ['draft', 'scheduled', 'sending'])
      .select()
      .maybeSingle();

    if (error) {
      throw new ApiError(500, 'internal_error', error.message);
    }
    if (!data) {
      // Either the blast doesn't exist (RLS hides it) or it's already
      // sent / failed / cancelled. Conflict communicates the latter,
      // 404 the former — but we can't tell them apart from the CAS
      // result. Pick conflict because the typical case is "user
      // clicked cancel on a row that just finished".
      throw new ApiError(409, 'conflict', 'Blast is not in a cancellable status');
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});
