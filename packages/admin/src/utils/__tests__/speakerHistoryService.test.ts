import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The query recorder. Every `supabase.from(...)` chain records the table and
 * the filters applied, so a test can assert what the service asked the
 * database for — which is the only way to pin the §7.3 rule that a person's
 * talks are reached through `person_id` and never through a name.
 */
interface RecordedQuery {
  table: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
  select?: string;
  update?: Record<string, unknown>;
}

const recorded: RecordedQuery[] = [];
let responder: (q: RecordedQuery) => { data: unknown[]; error: unknown } = () => ({
  data: [],
  error: null,
});

function makeBuilder(query: RecordedQuery) {
  const builder: Record<string, unknown> = {};
  const chain = (op: string) => (column: string, value?: unknown) => {
    query.filters.push({ op, column, value });
    return builder;
  };
  Object.assign(builder, {
    select: (cols: string) => {
      query.select = cols;
      return builder;
    },
    update: (fields: Record<string, unknown>) => {
      query.update = fields;
      return builder;
    },
    eq: chain('eq'),
    is: chain('is'),
    in: chain('in'),
    ilike: chain('ilike'),
    limit: (n: number) => {
      query.filters.push({ op: 'limit', column: '', value: n });
      return builder;
    },
    then: (resolve: (r: { data: unknown[]; error: unknown }) => unknown) =>
      Promise.resolve(responder(query)).then(resolve),
  });
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const query: RecordedQuery = { table, filters: [] };
      recorded.push(query);
      return makeBuilder(query);
    },
  },
}));

const {
  assembleSpeakerHistory,
  sanitizeNamePattern,
  fetchLinkedProfileIds,
  fetchSpeakerHistory,
  fetchPlaceholderCandidates,
  linkProfileToPerson,
} = await import('../speakerHistoryService');

beforeEach(() => {
  recorded.length = 0;
  responder = () => ({ data: [], error: null });
});

function queriesFor(table: string) {
  return recorded.filter((q) => q.table === table);
}

describe('sanitizeNamePattern', () => {
  it('strips the metacharacters that would widen an ilike pattern', () => {
    // `%` and `_` are SQL LIKE wildcards; `*` is PostgREST's own alias for
    // `%`. Any of them left in would match every placeholder profile in the
    // table and offer another person's unresolved profiles for linking.
    expect(sanitizeNamePattern('%')).toBe('');
    expect(sanitizeNamePattern('*')).toBe('');
    expect(sanitizeNamePattern('_')).toBe('');
    expect(sanitizeNamePattern('Jane%Doe')).toBe('JaneDoe');
    expect(sanitizeNamePattern('Jane*')).toBe('Jane');
    expect(sanitizeNamePattern('Jane,id.gt.0')).toBe('Janeid.gt.0');
    expect(sanitizeNamePattern('Jane\\Doe')).toBe('JaneDoe');
    expect(sanitizeNamePattern('Jane (Doe)')).toBe('Jane Doe');
  });

  it('leaves an ordinary name alone and caps the length', () => {
    expect(sanitizeNamePattern('  Jane Doe  ')).toBe('Jane Doe');
    expect(sanitizeNamePattern('Zoë Ñuñez-O\'Brien')).toBe("Zoë Ñuñez-O'Brien");
    expect(sanitizeNamePattern('a'.repeat(200))).toHaveLength(100);
  });
});

describe('fetchLinkedProfileIds — the §7.3 person_id-only rule', () => {
  it('filters profiles by person_id, never by name', async () => {
    responder = (q) =>
      q.table === 'events_speaker_profiles' && q.filters.some((f) => f.op === 'eq')
        ? { data: [{ id: 'profile-1' }], error: null }
        : { data: [], error: null };

    await fetchLinkedProfileIds('person-1');

    const profileQueries = queriesFor('events_speaker_profiles');
    expect(profileQueries[0].filters).toEqual([
      { op: 'eq', column: 'person_id', value: 'person-1' },
    ]);
    // Inversion test: if any read of the profile table ever filtered on name,
    // a placeholder profile could reach the history.
    for (const q of profileQueries) {
      expect(q.filters.map((f) => f.column)).not.toContain('name');
    }
  });

  it('follows canonical_profile_id aliases of a linked profile', async () => {
    responder = (q) => {
      if (q.table !== 'events_speaker_profiles') return { data: [], error: null };
      if (q.filters.some((f) => f.column === 'person_id')) {
        return { data: [{ id: 'profile-1' }], error: null };
      }
      return { data: [{ id: 'alias-1' }], error: null };
    };

    expect(await fetchLinkedProfileIds('person-1')).toEqual(['profile-1', 'alias-1']);
    expect(queriesFor('events_speaker_profiles')[1].filters).toEqual([
      { op: 'in', column: 'canonical_profile_id', value: ['profile-1'] },
    ]);
  });

  it('does not look up aliases, talks or events when nothing is linked', async () => {
    const history = await fetchSpeakerHistory('person-1');

    expect(history).toEqual({ profileIds: [], events: [], videosAvailable: false });
    // One query only: the person_id lookup. A person with no linked profile
    // must not cause a single read keyed on anything else.
    expect(recorded).toHaveLength(1);
    expect(recorded[0].table).toBe('events_speaker_profiles');
  });
});

describe('fetchSpeakerHistory', () => {
  it('keys every downstream read on the linked profile ids', async () => {
    responder = (q) => {
      if (q.table === 'events_speaker_profiles') {
        return q.filters.some((f) => f.column === 'person_id')
          ? { data: [{ id: 'profile-1' }], error: null }
          : { data: [], error: null };
      }
      if (q.table === 'events_speakers') {
        return {
          data: [{ event_uuid: 'event-1', speaker_id: 'profile-1', status: 'confirmed' }],
          error: null,
        };
      }
      if (q.table === 'events') {
        return {
          data: [
            { id: 'event-1', event_id: 'EV1', event_title: 'AGNTCon', event_start: '2026-05-01' },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };

    const history = await fetchSpeakerHistory('person-1');

    expect(history.profileIds).toEqual(['profile-1']);
    expect(history.events).toHaveLength(1);
    expect(history.events[0].eventTitle).toBe('AGNTCon');
    for (const table of ['events_speakers', 'events_talk_speakers', 'events_agenda_entry_speakers']) {
      expect(queriesFor(table)[0].filters).toEqual([
        { op: 'in', column: 'speaker_id', value: ['profile-1'] },
      ]);
    }
  });

  it('reports videos unavailable when the recap video link errors', async () => {
    responder = (q) => {
      if (q.table === 'events_speaker_profiles') {
        return q.filters.some((f) => f.column === 'person_id')
          ? { data: [{ id: 'profile-1' }], error: null }
          : { data: [], error: null };
      }
      if (q.table === 'events_talk_speakers') {
        return { data: [{ talk_id: 'talk-1', speaker_id: 'profile-1', role: 'presenter' }], error: null };
      }
      if (q.table === 'events_talks') {
        return { data: [{ id: 'talk-1', event_uuid: 'event-1', title: 'Agents at scale' }], error: null };
      }
      if (q.table === 'events_agenda_entries') {
        return {
          data: [{ id: 'entry-1', event_uuid: 'event-1', talk_id: 'talk-1', location: 'Hall A' }],
          error: null,
        };
      }
      if (q.table === 'conference_recap_videos') {
        // conference-recap's agenda_entry_id column (lf-gatewaze-modules#54)
        // has not landed on this brand.
        return { data: [], error: { code: '42703', message: 'column does not exist' } };
      }
      return { data: [], error: null };
    };

    const history = await fetchSpeakerHistory('person-1');

    expect(history.videosAvailable).toBe(false);
    expect(history.events[0].sessions[0].title).toBe('Agents at scale');
    expect(history.events[0].sessions[0].videos).toEqual([]);
  });
});

describe('fetchPlaceholderCandidates', () => {
  it('only ever offers profiles with no person and no canonical parent', async () => {
    responder = (q) =>
      q.table === 'events_speaker_profiles'
        ? { data: [{ id: 'ph-1', name: 'Jane Doe', title: null, company: null, avatar_url: null }], error: null }
        : { data: [], error: null };

    const candidates = await fetchPlaceholderCandidates('Jane Doe');

    expect(candidates.map((c) => c.id)).toEqual(['ph-1']);
    const q = queriesFor('events_speaker_profiles')[0];
    expect(q.filters).toContainEqual({ op: 'is', column: 'person_id', value: null });
    expect(q.filters).toContainEqual({ op: 'is', column: 'canonical_profile_id', value: null });
    expect(q.filters).toContainEqual({ op: 'ilike', column: 'name', value: 'Jane Doe' });
  });

  it('does not query at all for a name too short to be a match', async () => {
    expect(await fetchPlaceholderCandidates('Jo')).toEqual([]);
    expect(await fetchPlaceholderCandidates('%')).toEqual([]);
    expect(recorded).toHaveLength(0);
  });
});

describe('linkProfileToPerson', () => {
  it('records the new profile as an alias when the person already has one', async () => {
    // idx_events_speaker_profiles_person is unique on person_id where
    // canonical_profile_id IS NULL, so the second profile must be an alias.
    responder = (q) =>
      q.table === 'events_speaker_profiles' && !q.update
        ? { data: [{ id: 'canonical-1' }], error: null }
        : { data: [], error: null };

    expect(await linkProfileToPerson('ph-1', 'person-1')).toEqual({ error: null });

    const update = queriesFor('events_speaker_profiles').find((q) => q.update);
    expect(update?.update).toEqual({ person_id: 'person-1', canonical_profile_id: 'canonical-1' });
    // Only an unlinked profile may be claimed — never one already on someone else.
    expect(update?.filters).toContainEqual({ op: 'is', column: 'person_id', value: null });
  });

  it('links directly when the person has no profile yet', async () => {
    expect(await linkProfileToPerson('ph-1', 'person-1')).toEqual({ error: null });
    const update = queriesFor('events_speaker_profiles').find((q) => q.update);
    expect(update?.update).toEqual({ person_id: 'person-1', canonical_profile_id: null });
  });

  it('surfaces a rejected write instead of reporting success', async () => {
    responder = (q) =>
      q.update
        ? { data: [], error: { message: 'new row violates row-level security policy' } }
        : { data: [], error: null };

    expect(await linkProfileToPerson('ph-1', 'person-1')).toEqual({
      error: 'new row violates row-level security policy',
    });
  });
});

describe('assembleSpeakerHistory', () => {
  const empty = {
    eventSpeakers: [],
    talks: [],
    talkSpeakers: [],
    agendaEntries: [],
    tracks: [],
    events: [],
    videos: [],
  };

  it('orders events newest first and puts an undated event last', () => {
    const out = assembleSpeakerHistory({
      ...empty,
      eventSpeakers: [
        { event_uuid: 'old', speaker_id: 'p1' },
        { event_uuid: 'new', speaker_id: 'p1' },
        { event_uuid: 'undated', speaker_id: 'p1' },
      ],
      events: [
        { id: 'old', event_title: 'Seoul 2024', event_start: '2024-08-27T00:00:00Z' },
        { id: 'new', event_title: 'AGNTCon 2026', event_start: '2026-10-10T00:00:00Z' },
        { id: 'undated', event_title: 'No date', event_start: null },
      ],
    });

    expect(out.map((e) => e.eventTitle)).toEqual(['AGNTCon 2026', 'Seoul 2024', 'No date']);
  });

  it('joins track, room, time and the matched video onto a talk', () => {
    const out = assembleSpeakerHistory({
      ...empty,
      talkSpeakers: [{ talk_id: 'talk-1', speaker_id: 'p1', role: 'moderator', is_primary: true }],
      talks: [
        { id: 'talk-1', event_uuid: 'event-1', title: 'Agents in production', session_type: 'panel' },
      ],
      agendaEntries: [
        {
          id: 'entry-1',
          event_uuid: 'event-1',
          track_id: 'track-1',
          talk_id: 'talk-1',
          start_time: '2026-10-10T09:00:00Z',
          end_time: '2026-10-10T09:45:00Z',
          location: 'Grand Ballroom 2',
        },
      ],
      tracks: [{ id: 'track-1', name: 'Agentic Platforms' }],
      events: [{ id: 'event-1', event_id: 'AGNT26', event_title: 'AGNTCon', event_start: '2026-10-10' }],
      videos: [{ video_id: 'vid1', raw_title: 'Agents in production - Jane Doe', agenda_entry_id: 'entry-1' }],
    });

    expect(out).toHaveLength(1);
    expect(out[0].eventCode).toBe('AGNT26');
    const session = out[0].sessions[0];
    expect(session.title).toBe('Agents in production');
    expect(session.sessionType).toBe('panel');
    expect(session.role).toBe('moderator');
    expect(session.trackName).toBe('Agentic Platforms');
    expect(session.room).toBe('Grand Ballroom 2');
    expect(session.videos).toEqual([{ videoId: 'vid1', title: 'Agents in production - Jane Doe' }]);
  });

  it('keeps a talk whose agenda has not been imported', () => {
    const out = assembleSpeakerHistory({
      ...empty,
      talkSpeakers: [{ talk_id: 'talk-1', speaker_id: 'p1' }],
      talks: [{ id: 'talk-1', event_uuid: 'event-1', title: 'Unscheduled talk' }],
      events: [{ id: 'event-1', event_title: 'AGNTCon', event_start: '2026-10-10' }],
    });

    expect(out[0].sessions[0]).toMatchObject({
      title: 'Unscheduled talk',
      trackName: null,
      room: null,
      startTime: null,
      videos: [],
    });
  });

  it('drops a calendar-scoped talk, which has no event to file it under', () => {
    const out = assembleSpeakerHistory({
      ...empty,
      talkSpeakers: [{ talk_id: 'talk-1', speaker_id: 'p1' }],
      talks: [{ id: 'talk-1', event_uuid: null, title: 'Chapter pool submission' }],
    });

    expect(out).toEqual([]);
  });

  it('includes an agenda entry the person is on with no talk row behind it', () => {
    const out = assembleSpeakerHistory({
      ...empty,
      agendaEntries: [
        { id: 'entry-1', event_uuid: 'event-1', title: 'Opening remarks', location: 'Main Stage' },
      ],
      events: [{ id: 'event-1', event_title: 'AGNTCon', event_start: '2026-10-10' }],
    });

    expect(out[0].sessions).toHaveLength(1);
    expect(out[0].sessions[0]).toMatchObject({ title: 'Opening remarks', room: 'Main Stage' });
  });

  it('does not list the same session twice when reached by both paths', () => {
    const out = assembleSpeakerHistory({
      ...empty,
      talkSpeakers: [{ talk_id: 'talk-1', speaker_id: 'p1' }],
      talks: [{ id: 'talk-1', event_uuid: 'event-1', title: 'Agents at scale' }],
      agendaEntries: [{ id: 'entry-1', event_uuid: 'event-1', talk_id: 'talk-1' }],
      events: [{ id: 'event-1', event_title: 'AGNTCon', event_start: '2026-10-10' }],
    });

    expect(out[0].sessions).toHaveLength(1);
  });

  it('falls back to the billed talk title when the programme has nothing', () => {
    const out = assembleSpeakerHistory({
      ...empty,
      eventSpeakers: [
        {
          event_uuid: 'event-1',
          speaker_id: 'p1',
          status: 'pending',
          speaker_title: 'Staff Engineer',
          talk_title: 'Why agents fail',
        },
      ],
      events: [{ id: 'event-1', event_title: 'AGNTCon', event_start: '2026-10-10' }],
    });

    expect(out[0].speakerStatus).toBe('pending');
    expect(out[0].speakerTitle).toBe('Staff Engineer');
    expect(out[0].sessions[0].title).toBe('Why agents fail');
  });

  it('sorts sessions within an event by start time', () => {
    const out = assembleSpeakerHistory({
      ...empty,
      agendaEntries: [
        { id: 'b', event_uuid: 'e1', title: 'Afternoon', start_time: '2026-10-10T14:00:00Z' },
        { id: 'a', event_uuid: 'e1', title: 'Morning', start_time: '2026-10-10T09:00:00Z' },
      ],
      events: [{ id: 'e1', event_title: 'AGNTCon', event_start: '2026-10-10' }],
    });

    expect(out[0].sessions.map((s) => s.title)).toEqual(['Morning', 'Afternoon']);
  });

  it('names an event it cannot resolve rather than rendering a blank card', () => {
    const out = assembleSpeakerHistory({
      ...empty,
      eventSpeakers: [{ event_uuid: 'gone', speaker_id: 'p1' }],
    });

    expect(out[0]).toMatchObject({ eventTitle: 'Untitled event', eventCode: null });
  });
});
