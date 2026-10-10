import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  MicrophoneIcon,
  MapPinIcon,
  ClockIcon,
  PlayCircleIcon,
  Squares2X2Icon,
  LinkIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Badge, Button } from '@/components/ui';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import {
  fetchSpeakerHistory,
  fetchPlaceholderCandidates,
  linkProfileToPerson,
  type SpeakerEventHistory,
  type SpeakerTalkSession,
  type PlaceholderCandidate,
} from '@/utils/speakerHistoryService';

/**
 * Every event this person has spoken at — past and upcoming, newest first —
 * with the session, track, room and (where a conference recap has matched one)
 * the talk's video. Per spec-event-agenda-schedule-import.md §10.2.
 *
 * It reads only through an explicit `events_speaker_profiles.person_id` link
 * (or a merged alias of one). A placeholder profile that happens to share this
 * person's name is never shown as their talk — it is offered below as
 * something an admin can link by hand. See speakerHistoryService.ts for why.
 */

interface PersonSpeakerHistoryProps {
  personId: string;
  /** Display name, used only to suggest placeholder profiles to link. */
  personName?: string;
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  talk: 'Talk',
  panel: 'Panel',
  workshop: 'Workshop',
  lightning: 'Lightning talk',
  fireside: 'Fireside',
  keynote: 'Keynote',
};

const ROLE_LABEL: Record<string, string> = {
  presenter: 'Presenter',
  panelist: 'Panelist',
  moderator: 'Moderator',
  co_presenter: 'Co-presenter',
  host: 'Host',
};

function formatEventDate(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTimeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const from = s.toLocaleTimeString('en-US', opts);
  if (!end) return from;
  const e = new Date(end);
  if (Number.isNaN(e.getTime())) return from;
  return `${from} – ${e.toLocaleTimeString('en-US', opts)}`;
}

function isUpcoming(ts: string | null): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return !Number.isNaN(t) && t > Date.now();
}

function SessionRow({ session }: { session: SpeakerTalkSession }) {
  const time = formatTimeRange(session.startTime, session.endTime);
  const typeLabel = session.sessionType
    ? SESSION_TYPE_LABEL[session.sessionType] ?? session.sessionType
    : null;
  const roleLabel = session.role ? ROLE_LABEL[session.role] ?? session.role : null;

  return (
    <li className="border-l-2 border-[var(--gray-a5)] pl-3 py-1.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-[var(--gray-12)]">{session.title}</span>
        {typeLabel && (
          <Badge variant="soft" color="neutral" size="1">
            {typeLabel}
          </Badge>
        )}
        {roleLabel && roleLabel !== 'Presenter' && (
          <Badge variant="outline" color="neutral" size="1">
            {roleLabel}
          </Badge>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--gray-11)]">
        {session.trackName && (
          <span className="flex items-center gap-1">
            <Squares2X2Icon className="size-3.5" />
            {session.trackName}
          </span>
        )}
        {session.room && (
          <span className="flex items-center gap-1">
            <MapPinIcon className="size-3.5" />
            {session.room}
          </span>
        )}
        {time && (
          <span className="flex items-center gap-1">
            <ClockIcon className="size-3.5" />
            {time}
          </span>
        )}
      </div>
      {session.videos.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {session.videos.map((video) => (
            <a
              key={video.videoId}
              href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[var(--accent-11)] hover:underline"
            >
              <PlayCircleIcon className="size-3.5 shrink-0" />
              <span className="truncate">{video.title || 'Session recording'}</span>
            </a>
          ))}
        </div>
      )}
    </li>
  );
}

function EventCard({ event }: { event: SpeakerEventHistory }) {
  const date = formatEventDate(event.eventStart);
  const upcoming = isUpcoming(event.eventStart);

  return (
    <div className="rounded-lg border border-[var(--gray-a5)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {event.eventCode ? (
              <Link
                to={`/events/${event.eventCode}`}
                className="font-medium text-[var(--accent-11)] hover:underline"
              >
                {event.eventTitle}
              </Link>
            ) : (
              <span className="font-medium text-[var(--gray-12)]">{event.eventTitle}</span>
            )}
            {upcoming && (
              <Badge variant="soft" color="info" size="1">
                Upcoming
              </Badge>
            )}
            {event.speakerStatus && event.speakerStatus !== 'confirmed' && (
              <Badge variant="soft" color="warning" size="1">
                {event.speakerStatus}
              </Badge>
            )}
          </div>
          {(date || event.speakerTitle) && (
            <p className="mt-0.5 text-xs text-[var(--gray-11)]">
              {date}
              {date && event.speakerTitle ? ' · ' : ''}
              {event.speakerTitle}
            </p>
          )}
        </div>
      </div>
      {event.sessions.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {event.sessions.map((session) => (
            <SessionRow key={session.key} session={session} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-[var(--gray-11)]">
          Billed as a speaker; no session on the programme yet.
        </p>
      )}
    </div>
  );
}

export function PersonSpeakerHistory({ personId, personName }: PersonSpeakerHistoryProps) {
  const [events, setEvents] = useState<SpeakerEventHistory[]>([]);
  const [hasLinkedProfile, setHasLinkedProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PlaceholderCandidate[]>([]);
  const [linking, setLinking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const history = await fetchSpeakerHistory(personId);
      setEvents(history.events);
      setHasLinkedProfile(history.profileIds.length > 0);
    } catch (err) {
      console.error('Error loading speaker history:', err);
      setLoadError('Could not load speaking history.');
      setEvents([]);
      setHasLinkedProfile(false);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  const loadCandidates = useCallback(async () => {
    if (!personName) {
      setCandidates([]);
      return;
    }
    try {
      setCandidates(await fetchPlaceholderCandidates(personName));
    } catch (err) {
      // Suggestions are a convenience; failing to find any is not an error
      // worth putting in front of the operator.
      console.error('Error loading placeholder speaker profiles:', err);
      setCandidates([]);
    }
  }, [personName]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  const handleLink = async (candidate: PlaceholderCandidate) => {
    setLinking(candidate.id);
    try {
      const { error } = await linkProfileToPerson(candidate.id, personId);
      if (error) {
        toast.error(`Could not link that profile: ${error}`);
        return;
      }
      toast.success(`Linked "${candidate.name}" to this person`);
      await Promise.all([load(), loadCandidates()]);
    } finally {
      setLinking(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="medium" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--red-a6)] bg-[var(--red-a2)] p-3 text-sm text-[var(--gray-12)]">
          <ExclamationTriangleIcon className="size-5 shrink-0 text-[var(--red-11)]" />
          <span>{loadError}</span>
        </div>
      )}

      {events.length > 0 ? (
        <div className="space-y-3">
          {events.map((event) => (
            <EventCard key={event.eventUuid} event={event} />
          ))}
        </div>
      ) : (
        !loadError && (
          <div className="py-8 text-center text-[var(--gray-11)]">
            <MicrophoneIcon className="mx-auto mb-3 size-10 opacity-50" />
            <p>
              {hasLinkedProfile
                ? 'This person has a speaker profile but no talks on any programme yet.'
                : 'No speaker profile is linked to this person yet.'}
            </p>
          </div>
        )
      )}

      {candidates.length > 0 && (
        <div className="rounded-lg border border-dashed border-[var(--gray-a6)] p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--gray-12)]">
            <LinkIcon className="size-4" />
            Unlinked speaker profiles with this name
          </h3>
          <p className="mt-1 text-xs text-[var(--gray-11)]">
            These speaker profiles are not attached to any person, and their talks are
            deliberately not shown above — a name is not proof of identity. Check the events
            below, then link one if it really is this person.
          </p>
          <ul className="mt-3 space-y-2">
            {candidates.map((candidate) => (
              <li
                key={candidate.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-[var(--gray-a2)] p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--gray-12)]">{candidate.name}</p>
                  {(candidate.title || candidate.company) && (
                    <p className="text-xs text-[var(--gray-11)]">
                      {[candidate.title, candidate.company].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {candidate.eventTitles.length > 0 && (
                    <p className="mt-0.5 text-xs text-[var(--gray-a9)]">
                      {candidate.eventTitles.join(', ')}
                    </p>
                  )}
                </div>
                <Button
                  variant="soft"
                  size="1"
                  disabled={linking !== null}
                  onClick={() => handleLink(candidate)}
                >
                  {linking === candidate.id ? 'Linking…' : 'Link to this person'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
