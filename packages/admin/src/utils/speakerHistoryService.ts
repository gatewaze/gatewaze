/**
 * Speaker history for a person — "which events has this person spoken at?"
 *
 * Per spec-event-agenda-schedule-import.md §10.2. The schedule importer
 * creates events_speaker_profiles + events_speakers + events_talks rows at
 * programme scale, so this question finally has data behind it.
 *
 * THE CORRECTNESS RULE (spec §7.3)
 * --------------------------------
 * A person's talks are reached ONLY through an explicit link:
 *
 *   events_speaker_profiles.person_id = <person>          (resolved profile)
 *   events_speaker_profiles.canonical_profile_id = <one of those>  (merged alias)
 *
 * A profile with `person_id IS NULL` is a placeholder. It is NEVER matched to
 * a person by name, however plausible the name looks: showing one person's
 * talks on another person's record is the exact failure the rule exists to
 * prevent. Name matching appears in exactly one place in this file —
 * `fetchPlaceholderCandidates`, which only *suggests* profiles for a human to
 * link by hand, and whose results never enter the history.
 *
 * Table shapes this reads (all live in the event-speakers / event-agenda
 * modules, so every one of them can be absent on a brand that has not
 * installed them — each read degrades to "nothing to show"):
 *
 *   events_speaker_profiles    id, person_id, canonical_profile_id, name, …
 *   events_speakers            event_uuid, speaker_id -> profiles.id, status
 *   events_talks               id, event_uuid, title, session_type, status
 *   events_talk_speakers       talk_id, speaker_id -> profiles.id, role
 *   events_agenda_entries      id, event_uuid, track_id, talk_id, start_time, location
 *   events_agenda_entry_speakers  agenda_entry_id, speaker_id -> profiles.id
 *   events_agenda_tracks       id, name
 *   events                     id, event_id (short code), event_title, event_start
 *   conference_recap_videos    video_id, raw_title, agenda_entry_id
 *
 * Note on the two speaker-id spaces: `events_talk_speakers.speaker_id` and
 * `events_agenda_entry_speakers.speaker_id` both point at
 * events_speaker_profiles(id) — the same id `events_speakers.speaker_id`
 * carries — per event-speakers migrations 008 and 011. Do not join them
 * through events_speakers(id).
 */

import { supabase } from '@/lib/supabase';

/* ------------------------------------------------------------------ types */

export interface SpeakerTalkVideo {
  videoId: string;
  title: string | null;
}

export interface SpeakerTalkSession {
  /** Stable React key. */
  key: string;
  talkId: string | null;
  agendaEntryId: string | null;
  title: string;
  sessionType: string | null;
  talkStatus: string | null;
  /** events_talk_speakers.role — presenter / panelist / moderator / … */
  role: string | null;
  trackName: string | null;
  /** events_agenda_entries.location — the room. */
  room: string | null;
  startTime: string | null;
  endTime: string | null;
  videos: SpeakerTalkVideo[];
}

export interface SpeakerEventHistory {
  eventUuid: string;
  /** events.event_id — the short code admin URLs use. */
  eventCode: string | null;
  eventTitle: string;
  eventStart: string | null;
  eventStatus: string | null;
  /** events_speakers.status for this person at this event, when there is a row. */
  speakerStatus: string | null;
  /** events_speakers.speaker_title — the role as billed for this event. */
  speakerTitle: string | null;
  sessions: SpeakerTalkSession[];
}

export interface SpeakerHistory {
  /** The explicitly-linked profile ids the history was built from. */
  profileIds: string[];
  /** Newest event first; both past and upcoming. */
  events: SpeakerEventHistory[];
  /**
   * False when the recap video link is unavailable (the conference-recap
   * module is not installed, or its agenda_entry_id column has not landed).
   * The tab stays useful either way; it just does not promise videos.
   */
  videosAvailable: boolean;
}

export interface PlaceholderCandidate {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  avatarUrl: string | null;
  /** Events this placeholder profile is billed at, for human disambiguation. */
  eventTitles: string[];
}

/* -------------------------------------------------------------- raw shapes */

export interface ProfileRow {
  id: string;
  person_id?: string | null;
  canonical_profile_id?: string | null;
}

export interface EventSpeakerRow {
  event_uuid: string | null;
  speaker_id: string | null;
  status?: string | null;
  speaker_title?: string | null;
  talk_title?: string | null;
}

export interface TalkRow {
  id: string;
  event_uuid: string | null;
  title: string | null;
  session_type?: string | null;
  status?: string | null;
}

export interface TalkSpeakerRow {
  talk_id: string;
  speaker_id: string;
  role?: string | null;
  is_primary?: boolean | null;
}

export interface AgendaEntryRow {
  id: string;
  event_uuid: string | null;
  track_id?: string | null;
  talk_id?: string | null;
  title?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  entry_type?: string | null;
}

export interface TrackRow {
  id: string;
  name: string | null;
}

export interface EventRow {
  id: string;
  event_id?: string | null;
  event_title?: string | null;
  event_start?: string | null;
  status?: string | null;
}

export interface RecapVideoRow {
  video_id: string | null;
  raw_title?: string | null;
  agenda_entry_id?: string | null;
}

export interface SpeakerHistoryInput {
  eventSpeakers: EventSpeakerRow[];
  talks: TalkRow[];
  talkSpeakers: TalkSpeakerRow[];
  agendaEntries: AgendaEntryRow[];
  tracks: TrackRow[];
  events: EventRow[];
  videos: RecapVideoRow[];
}

/* ---------------------------------------------------------------- helpers */

/**
 * Strip the metacharacters that change what a PostgREST `ilike` pattern
 * matches, then cap the length.
 *
 * `,` `(` `)` `*` `\` are the repo's canonical PostgREST filter-grammar strip
 * (.claude/rules/security-boundaries.md) — `*` in particular is PostgREST's
 * own alias for `%`. `%` and `_` are added here because this value reaches
 * `.ilike()` directly as the whole pattern, where an unescaped one would widen
 * the suggestion list to every placeholder profile in the table — i.e. would
 * leak other people's unresolved speaker profiles into this person's record.
 */
export function sanitizeNamePattern(value: string): string {
  return String(value ?? '')
    .replace(/[,()*\\%_]/g, '')
    .trim()
    .slice(0, 100);
}

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

/** Postgres error codes for "that table/column does not exist here". */
const MISSING_RELATION_CODES = new Set(['42703', '42P01', 'PGRST204', 'PGRST205']);

function isMissingRelation(error: { code?: string | null } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_RELATION_CODES.has(error.code));
}

function epoch(ts: string | null | undefined): number {
  if (!ts) return Number.NEGATIVE_INFINITY;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/* --------------------------------------------------------------- assembly */

/**
 * Fold the raw rows into one group per event, newest event first.
 *
 * Pure so the grouping, the title fallback chain and the ordering can be
 * tested without a database. Every row handed in must already have been
 * filtered to the person's explicitly-linked profile ids — this function
 * cannot tell a placeholder from a resolved profile.
 */
export function assembleSpeakerHistory(input: SpeakerHistoryInput): SpeakerEventHistory[] {
  const eventsById = new Map<string, EventRow>();
  for (const e of input.events) eventsById.set(e.id, e);

  const trackNames = new Map<string, string>();
  for (const t of input.tracks) if (t.name) trackNames.set(t.id, t.name);

  const videosByEntry = new Map<string, SpeakerTalkVideo[]>();
  for (const v of input.videos) {
    if (!v.agenda_entry_id || !v.video_id) continue;
    const list = videosByEntry.get(v.agenda_entry_id) ?? [];
    list.push({ videoId: v.video_id, title: v.raw_title ?? null });
    videosByEntry.set(v.agenda_entry_id, list);
  }

  const talksById = new Map<string, TalkRow>();
  for (const t of input.talks) talksById.set(t.id, t);

  // An agenda entry can be reached two ways: through the talk it hangs off,
  // or directly (events_agenda_entry_speakers, for an entry with no talk row).
  const entriesByTalk = new Map<string, AgendaEntryRow>();
  const entriesById = new Map<string, AgendaEntryRow>();
  for (const entry of input.agendaEntries) {
    entriesById.set(entry.id, entry);
    if (entry.talk_id && !entriesByTalk.has(entry.talk_id)) entriesByTalk.set(entry.talk_id, entry);
  }

  // Per-event buckets, keyed by event uuid.
  const buckets = new Map<string, SpeakerEventHistory>();
  const bucketFor = (eventUuid: string): SpeakerEventHistory => {
    let bucket = buckets.get(eventUuid);
    if (!bucket) {
      const event = eventsById.get(eventUuid);
      bucket = {
        eventUuid,
        eventCode: event?.event_id ?? null,
        eventTitle: event?.event_title ?? 'Untitled event',
        eventStart: event?.event_start ?? null,
        eventStatus: event?.status ?? null,
        speakerStatus: null,
        speakerTitle: null,
        sessions: [],
      };
      buckets.set(eventUuid, bucket);
    }
    return bucket;
  };

  // 1. Event-level participation. This is what makes an event appear at all
  //    for a speaker who was billed but whose programme has no talk row.
  for (const es of input.eventSpeakers) {
    if (!es.event_uuid) continue;
    const bucket = bucketFor(es.event_uuid);
    bucket.speakerStatus = es.status ?? bucket.speakerStatus;
    bucket.speakerTitle = es.speaker_title ?? bucket.speakerTitle;
  }

  // 2. Talks the person is on, with their agenda entry when the programme has one.
  const seenEntryIds = new Set<string>();
  for (const ts of input.talkSpeakers) {
    const talk = talksById.get(ts.talk_id);
    if (!talk) continue;
    const entry = entriesByTalk.get(ts.talk_id) ?? null;
    const eventUuid = talk.event_uuid ?? entry?.event_uuid ?? null;
    // A calendar- or platform-scoped talk has no event; it belongs to the
    // speakers rollup's surfaces, not to an event history.
    if (!eventUuid) continue;
    if (entry) seenEntryIds.add(entry.id);
    bucketFor(eventUuid).sessions.push({
      key: `talk-${ts.talk_id}`,
      talkId: ts.talk_id,
      agendaEntryId: entry?.id ?? null,
      title: talk.title || entry?.title || 'Untitled session',
      sessionType: talk.session_type ?? null,
      talkStatus: talk.status ?? null,
      role: ts.role ?? null,
      trackName: entry?.track_id ? trackNames.get(entry.track_id) ?? null : null,
      room: entry?.location ?? null,
      startTime: entry?.start_time ?? null,
      endTime: entry?.end_time ?? null,
      videos: entry ? videosByEntry.get(entry.id) ?? [] : [],
    });
  }

  // 3. Agenda entries the person is on directly with no talk row behind them.
  for (const entry of input.agendaEntries) {
    if (!entry.event_uuid || seenEntryIds.has(entry.id)) continue;
    if (entry.talk_id && talksById.has(entry.talk_id)) continue;
    bucketFor(entry.event_uuid).sessions.push({
      key: `entry-${entry.id}`,
      talkId: entry.talk_id ?? null,
      agendaEntryId: entry.id,
      title: entry.title || 'Untitled session',
      sessionType: null,
      talkStatus: null,
      role: null,
      trackName: entry.track_id ? trackNames.get(entry.track_id) ?? null : null,
      room: entry.location ?? null,
      startTime: entry.start_time ?? null,
      endTime: entry.end_time ?? null,
      videos: videosByEntry.get(entry.id) ?? [],
    });
  }

  // 4. Last resort: a billed speaker with no talk and no agenda entry still
  //    carries a talk title on the participation row. Show it as the session.
  for (const es of input.eventSpeakers) {
    if (!es.event_uuid || !es.talk_title) continue;
    const bucket = bucketFor(es.event_uuid);
    if (bucket.sessions.length > 0) continue;
    bucket.sessions.push({
      key: `billed-${es.event_uuid}`,
      talkId: null,
      agendaEntryId: null,
      title: es.talk_title,
      sessionType: null,
      talkStatus: null,
      role: null,
      trackName: null,
      room: null,
      startTime: null,
      endTime: null,
      videos: [],
    });
  }

  const out = Array.from(buckets.values());
  for (const bucket of out) {
    bucket.sessions.sort(
      (a, b) => epoch(a.startTime) - epoch(b.startTime) || a.title.localeCompare(b.title),
    );
  }
  // Newest first (§10.2). An event with no date sorts last rather than first,
  // so a missing event_start never pushes itself to the top of the record.
  out.sort((a, b) => epoch(b.eventStart) - epoch(a.eventStart));
  return out;
}

/* ------------------------------------------------------------------ reads */

/**
 * The profile ids that are explicitly this person's: profiles linked by
 * `person_id`, plus profiles merged into one of those via
 * `canonical_profile_id`. Nothing else. No name matching.
 */
export async function fetchLinkedProfileIds(personId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('events_speaker_profiles')
    .select('id, person_id, canonical_profile_id')
    .eq('person_id', personId);

  if (error && !isMissingRelation(error)) throw error;
  const direct = uniq(((data ?? []) as unknown as ProfileRow[]).map((p) => p.id));
  if (direct.length === 0) return [];

  // Aliases: a merged duplicate points at the canonical profile. The merge was
  // an explicit admin action, so following it is still an explicit link.
  const { data: aliasData, error: aliasError } = await supabase
    .from('events_speaker_profiles')
    .select('id')
    .in('canonical_profile_id', direct);

  if (aliasError && !isMissingRelation(aliasError)) throw aliasError;
  const aliases = ((aliasData ?? []) as unknown as ProfileRow[]).map((p) => p.id);
  return uniq([...direct, ...aliases]);
}

export async function fetchSpeakerHistory(personId: string): Promise<SpeakerHistory> {
  const profileIds = await fetchLinkedProfileIds(personId);
  if (profileIds.length === 0) {
    return { profileIds: [], events: [], videosAvailable: false };
  }

  const [esRes, tsRes, aesRes] = await Promise.all([
    supabase
      .from('events_speakers')
      .select('event_uuid, speaker_id, status, speaker_title, talk_title')
      .in('speaker_id', profileIds),
    supabase
      .from('events_talk_speakers')
      .select('talk_id, speaker_id, role, is_primary')
      .in('speaker_id', profileIds),
    supabase
      .from('events_agenda_entry_speakers')
      .select('agenda_entry_id, speaker_id')
      .in('speaker_id', profileIds),
  ]);

  const eventSpeakers = (esRes.data ?? []) as unknown as EventSpeakerRow[];
  const talkSpeakers = (tsRes.data ?? []) as unknown as TalkSpeakerRow[];
  const directEntryIds = uniq(
    ((aesRes.data ?? []) as unknown as Array<{ agenda_entry_id: string | null }>).map(
      (r) => r.agenda_entry_id,
    ),
  );

  const talkIds = uniq(talkSpeakers.map((t) => t.talk_id));

  const [talksRes, entriesByTalkRes, entriesByIdRes] = await Promise.all([
    talkIds.length
      ? supabase
          .from('events_talks')
          .select('id, event_uuid, title, session_type, status')
          .in('id', talkIds)
      : Promise.resolve({ data: [], error: null }),
    talkIds.length
      ? supabase
          .from('events_agenda_entries')
          .select('id, event_uuid, track_id, talk_id, title, start_time, end_time, location, entry_type')
          .in('talk_id', talkIds)
      : Promise.resolve({ data: [], error: null }),
    directEntryIds.length
      ? supabase
          .from('events_agenda_entries')
          .select('id, event_uuid, track_id, talk_id, title, start_time, end_time, location, entry_type')
          .in('id', directEntryIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const talks = (talksRes.data ?? []) as unknown as TalkRow[];
  const entriesById = new Map<string, AgendaEntryRow>();
  for (const row of [
    ...((entriesByTalkRes.data ?? []) as unknown as AgendaEntryRow[]),
    ...((entriesByIdRes.data ?? []) as unknown as AgendaEntryRow[]),
  ]) {
    entriesById.set(row.id, row);
  }
  const agendaEntries = Array.from(entriesById.values());

  const trackIds = uniq(agendaEntries.map((e) => e.track_id));
  const eventUuids = uniq([
    ...eventSpeakers.map((e) => e.event_uuid),
    ...talks.map((t) => t.event_uuid),
    ...agendaEntries.map((e) => e.event_uuid),
  ]);
  const entryIds = agendaEntries.map((e) => e.id);

  const [tracksRes, eventsRes, videosRes] = await Promise.all([
    trackIds.length
      ? supabase.from('events_agenda_tracks').select('id, name').in('id', trackIds)
      : Promise.resolve({ data: [], error: null }),
    eventUuids.length
      ? supabase
          .from('events')
          .select('id, event_id, event_title, event_start, status')
          .in('id', eventUuids)
      : Promise.resolve({ data: [], error: null }),
    // The recap link is the newest and least-certain part of this: the
    // conference-recap module may not be installed, and its agenda_entry_id
    // column may not have landed yet. Either way we show the history without
    // videos rather than failing the tab.
    entryIds.length
      ? supabase
          .from('conference_recap_videos')
          .select('video_id, raw_title, agenda_entry_id')
          .in('agenda_entry_id', entryIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const videosAvailable = entryIds.length > 0 && !videosRes.error;

  return {
    profileIds,
    videosAvailable,
    events: assembleSpeakerHistory({
      eventSpeakers,
      talks,
      talkSpeakers,
      agendaEntries,
      tracks: (tracksRes.data ?? []) as unknown as TrackRow[],
      events: (eventsRes.data ?? []) as unknown as EventRow[],
      videos: videosRes.error ? [] : ((videosRes.data ?? []) as unknown as RecapVideoRow[]),
    }),
  };
}

/* -------------------------------------------------- placeholder resolution */

/**
 * Placeholder speaker profiles (`person_id IS NULL`) whose name looks like
 * this person's — **suggestions for a human to confirm**, nothing more.
 *
 * This is the one name-matching query in the file and its results never reach
 * `fetchSpeakerHistory`. §7.3: "Never fuzzy-match a person on name alone — a
 * wrong link puts one person's face on another's talk." So the match here is
 * deliberately an exact (case-insensitive) whole-name one, not a fuzzy or
 * substring one, and an admin still has to press the button.
 */
export async function fetchPlaceholderCandidates(
  personName: string,
  limit = 10,
): Promise<PlaceholderCandidate[]> {
  const pattern = sanitizeNamePattern(personName);
  if (pattern.length < 3) return [];

  const { data, error } = await supabase
    .from('events_speaker_profiles')
    .select('id, name, title, company, avatar_url')
    .is('person_id', null)
    .is('canonical_profile_id', null)
    .ilike('name', pattern)
    .limit(limit);

  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    name: string | null;
    title: string | null;
    company: string | null;
    avatar_url: string | null;
  }>;
  if (rows.length === 0) return [];

  // Event context, so the admin can tell two same-named speakers apart before
  // committing the link.
  const eventTitlesByProfile = new Map<string, string[]>();
  const { data: esData } = await supabase
    .from('events_speakers')
    .select('speaker_id, event_uuid')
    .in(
      'speaker_id',
      rows.map((r) => r.id),
    );
  const links = (esData ?? []) as unknown as Array<{ speaker_id: string; event_uuid: string | null }>;
  const eventUuids = uniq(links.map((l) => l.event_uuid));
  if (eventUuids.length) {
    const { data: evData } = await supabase
      .from('events')
      .select('id, event_title')
      .in('id', eventUuids);
    const titles = new Map<string, string>();
    for (const e of (evData ?? []) as unknown as EventRow[]) {
      if (e.event_title) titles.set(e.id, e.event_title);
    }
    for (const link of links) {
      if (!link.event_uuid) continue;
      const title = titles.get(link.event_uuid);
      if (!title) continue;
      const list = eventTitlesByProfile.get(link.speaker_id) ?? [];
      if (!list.includes(title)) list.push(title);
      eventTitlesByProfile.set(link.speaker_id, list);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? 'Unnamed profile',
    title: r.title ?? null,
    company: r.company ?? null,
    avatarUrl: r.avatar_url ?? null,
    eventTitles: eventTitlesByProfile.get(r.id) ?? [],
  }));
}

/**
 * Attach a placeholder profile to a person.
 *
 * `idx_events_speaker_profiles_person` is unique on `person_id` where
 * `canonical_profile_id IS NULL`, so a person can hold exactly one canonical
 * profile. When they already have one, the newly linked profile is recorded as
 * an alias of it (`canonical_profile_id`) — which is both what the index
 * requires and what event-speakers migration 002 says reads should expect:
 * "reads resolve via COALESCE(canonical_profile_id, id)".
 *
 * The write itself is gated by RLS (`speakers_update_admin` requires
 * `is_admin()`), so a non-admin gets a policy error rather than a silent link.
 */
export async function linkProfileToPerson(
  profileId: string,
  personId: string,
): Promise<{ error: string | null }> {
  const { data: existing, error: existingError } = await supabase
    .from('events_speaker_profiles')
    .select('id')
    .eq('person_id', personId)
    .is('canonical_profile_id', null)
    .limit(1);

  if (existingError) return { error: existingError.message };

  const canonical = ((existing ?? []) as unknown as ProfileRow[])[0]?.id ?? null;
  if (canonical === profileId) return { error: null };

  const { error } = await supabase
    .from('events_speaker_profiles')
    .update({ person_id: personId, canonical_profile_id: canonical })
    .eq('id', profileId)
    .is('person_id', null);

  return { error: error ? error.message : null };
}
