import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type {
  SpeakerHistory,
  PlaceholderCandidate,
} from '@/utils/speakerHistoryService';

const fetchSpeakerHistory = vi.fn<(personId: string) => Promise<SpeakerHistory>>();
const fetchPlaceholderCandidates = vi.fn<(name: string) => Promise<PlaceholderCandidate[]>>();
const linkProfileToPerson = vi.fn<
  (profileId: string, personId: string) => Promise<{ error: string | null }>
>();

vi.mock('@/utils/speakerHistoryService', () => ({
  fetchSpeakerHistory: (...args: [string]) => fetchSpeakerHistory(...args),
  fetchPlaceholderCandidates: (...args: [string]) => fetchPlaceholderCandidates(...args),
  linkProfileToPerson: (...args: [string, string]) => linkProfileToPerson(...args),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

const { PersonSpeakerHistory } = await import('../PersonSpeakerHistory');

const emptyHistory: SpeakerHistory = { profileIds: [], events: [], videosAvailable: false };

function renderTab(personName?: string) {
  return render(
    <MemoryRouter>
      <PersonSpeakerHistory personId="person-1" personName={personName} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchSpeakerHistory.mockReset().mockResolvedValue(emptyHistory);
  fetchPlaceholderCandidates.mockReset().mockResolvedValue([]);
  linkProfileToPerson.mockReset().mockResolvedValue({ error: null });
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe('PersonSpeakerHistory', () => {
  it('renders each event with its session, track, room and video', async () => {
    fetchSpeakerHistory.mockResolvedValue({
      profileIds: ['profile-1'],
      videosAvailable: true,
      events: [
        {
          eventUuid: 'event-1',
          eventCode: 'AGNT26',
          eventTitle: 'AGNTCon Europe',
          eventStart: '2026-10-10T09:00:00Z',
          eventStatus: 'published',
          speakerStatus: 'confirmed',
          speakerTitle: 'Staff Engineer',
          sessions: [
            {
              key: 'talk-1',
              talkId: 'talk-1',
              agendaEntryId: 'entry-1',
              title: 'Agents in production',
              sessionType: 'panel',
              talkStatus: 'confirmed',
              role: 'moderator',
              trackName: 'Agentic Platforms',
              room: 'Grand Ballroom 2',
              startTime: '2026-10-10T09:00:00Z',
              endTime: '2026-10-10T09:45:00Z',
              // A YouTube raw_title rarely equals the programme title — that
              // divergence is what §7.2's matcher exists to bridge.
              videos: [{ videoId: 'vid1', title: 'Agents in production - Jane Doe, Acme' }],
            },
          ],
        },
      ],
    });

    renderTab();

    expect(await screen.findByText('Agents in production')).toBeTruthy();
    expect(screen.getByText('Agentic Platforms')).toBeTruthy();
    expect(screen.getByText('Grand Ballroom 2')).toBeTruthy();
    expect(screen.getByText('Panel')).toBeTruthy();
    expect(screen.getByText('Moderator')).toBeTruthy();
    // The event title links to the admin event page by its short code.
    expect(screen.getByRole('link', { name: 'AGNTCon Europe' }).getAttribute('href')).toBe(
      '/events/AGNT26',
    );
    expect(
      screen.getByRole('link', { name: /Agents in production - Jane Doe, Acme/ }).getAttribute('href'),
    ).toBe('https://www.youtube.com/watch?v=vid1');
  });

  it('marks a future event as upcoming', async () => {
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    fetchSpeakerHistory.mockResolvedValue({
      profileIds: ['profile-1'],
      videosAvailable: false,
      events: [
        {
          eventUuid: 'event-1',
          eventCode: 'FUT01',
          eventTitle: 'Next year',
          eventStart: future,
          eventStatus: 'published',
          speakerStatus: 'confirmed',
          speakerTitle: null,
          sessions: [],
        },
      ],
    });

    renderTab();

    expect(await screen.findByText('Upcoming')).toBeTruthy();
    expect(screen.getByText(/no session on the programme yet/i)).toBeTruthy();
  });

  it('distinguishes "no profile linked" from "linked but no talks"', async () => {
    renderTab();
    expect(await screen.findByText(/No speaker profile is linked/i)).toBeTruthy();

    fetchSpeakerHistory.mockResolvedValue({
      profileIds: ['profile-1'],
      events: [],
      videosAvailable: false,
    });
    renderTab();
    expect(await screen.findByText(/no talks on any programme yet/i)).toBeTruthy();
  });

  it('offers a same-named placeholder profile to link without showing its talks', async () => {
    fetchPlaceholderCandidates.mockResolvedValue([
      {
        id: 'ph-1',
        name: 'Jane Doe',
        title: 'Principal Engineer',
        company: 'Acme',
        avatarUrl: null,
        eventTitles: ['AGNTCon Europe'],
      },
    ]);

    renderTab('Jane Doe');

    expect(await screen.findByText(/Unlinked speaker profiles with this name/i)).toBeTruthy();
    // The whole point of §7.3: the placeholder's events are context for the
    // human decision, not entries in this person's history.
    expect(screen.getByText(/a name is not proof of identity/i)).toBeTruthy();
    expect(screen.getByText(/No speaker profile is linked/i)).toBeTruthy();
    expect(screen.getByText('Principal Engineer · Acme')).toBeTruthy();
  });

  it('links a placeholder profile and reloads the history', async () => {
    fetchPlaceholderCandidates.mockResolvedValue([
      { id: 'ph-1', name: 'Jane Doe', title: null, company: null, avatarUrl: null, eventTitles: [] },
    ]);

    renderTab('Jane Doe');
    await userEvent.click(await screen.findByRole('button', { name: /Link to this person/i }));

    expect(linkProfileToPerson).toHaveBeenCalledWith('ph-1', 'person-1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // Once linked, the history is re-read so the newly-linked talks appear.
    expect(fetchSpeakerHistory).toHaveBeenCalledTimes(2);
  });

  it('reports a rejected link instead of claiming success', async () => {
    linkProfileToPerson.mockResolvedValue({ error: 'new row violates row-level security policy' });
    fetchPlaceholderCandidates.mockResolvedValue([
      { id: 'ph-1', name: 'Jane Doe', title: null, company: null, avatarUrl: null, eventTitles: [] },
    ]);

    renderTab('Jane Doe');
    await userEvent.click(await screen.findByRole('button', { name: /Link to this person/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(fetchSpeakerHistory).toHaveBeenCalledTimes(1);
  });

  it('shows an error state when the history cannot be read', async () => {
    fetchSpeakerHistory.mockRejectedValue(new Error('permission denied'));
    renderTab();
    expect(await screen.findByText(/Could not load speaking history/i)).toBeTruthy();
  });

  it('does not look for placeholder profiles when the person has no name', async () => {
    renderTab(undefined);
    await screen.findByText(/No speaker profile is linked/i);
    expect(fetchPlaceholderCandidates).not.toHaveBeenCalled();
  });
});
