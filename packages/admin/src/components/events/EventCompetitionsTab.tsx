// @ts-nocheck
import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  TrophyIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  UserIcon,
  ArrowDownTrayIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { Card, Button, Badge, ConfirmModal, Modal } from '@/components/ui-legacy';
import { Input, Select, Checkbox, Textarea } from '@/components/ui-legacy/Form';
import RichTextEditor from '@/components/ui-legacy/RichTextEditor';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { supabase } from '@/lib/supabase';
import EmailService from '@/utils/emailService';

interface Competition {
  id: string;
  event_id: string;
  title: string;
  slug: string;
  value: string | null;
  close_date: string | null;
  close_display: string | null;
  intro: string | null;
  content: string | null;
  status: 'active' | 'closed' | 'cancelled';
  is_beta: boolean;
  sort_order: number | null;
  created_at: string;
}

interface CompetitionEntry {
  id: string;
  competition_id: string;
  email: string;
  member_profile_id: string | null;
  status: string;
  entered_at: string | null;
  viewed_at: string | null;
  created_at: string;
  // Profile data from joins
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  city?: string;
  state?: string;
}

interface CompetitionFormData {
  title: string;
  slug: string;
  value: string;
  close_date: string;
  close_display: string;
  intro: string;
  content: string;
  status: string;
  is_beta: boolean;
}

const emptyFormData: CompetitionFormData = {
  title: '',
  slug: '',
  value: '',
  close_date: '',
  close_display: '',
  intro: '',
  content: '',
  status: 'active',
  is_beta: false,
};

const MultiSelectFilter = ({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`text-sm border rounded-md px-2 py-1 flex items-center gap-1 ${
          selected.length > 0
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
            : 'border-gray-200 dark:border-dark-300 bg-white dark:bg-surface-2 text-gray-700 dark:text-dark-100'
        }`}
      >
        {selected.length > 0 ? `${label} (${selected.length})` : label}
        <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 min-w-56 max-w-80 max-h-60 overflow-y-auto rounded-md border border-gray-200 dark:border-dark-300 bg-white dark:bg-surface-2 shadow-lg">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No options</div>
          ) : (
            <>
              {selected.length > 0 && (
                <button
                  onClick={() => onChange([])}
                  className="w-full text-left px-3 py-1.5 text-xs text-primary-600 dark:text-primary-400 hover:bg-gray-50 dark:hover:bg-surface-1 border-b border-gray-100 dark:border-dark-300"
                >
                  Clear selection
                </button>
              )}
              {options.map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-dark-100 hover:bg-gray-50 dark:hover:bg-surface-1 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => toggle(option)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

interface EventCompetitionsTabProps {
  eventId: string;
  eventTitle?: string;
  eventStart?: string;
  eventEnd?: string;
  offerTicketDetails?: string;
}

export const EventCompetitionsTab = ({ eventId, eventTitle, eventStart, eventEnd, offerTicketDetails }: EventCompetitionsTabProps) => {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [entriesMap, setEntriesMap] = useState<Record<string, CompetitionEntry[]>>({});
  const [loadingEntriesMap, setLoadingEntriesMap] = useState<Record<string, boolean>>({});
  const [filterJobTitles, setFilterJobTitles] = useState<string[]>([]);
  const [filterCities, setFilterCities] = useState<string[]>([]);
  const [filterStates, setFilterStates] = useState<string[]>([]);
  const [filterWinnerType, setFilterWinnerType] = useState<'all' | 'winners' | 'non-winners'>('all');
  const [filterWinnerStatuses, setFilterWinnerStatuses] = useState<string[]>([]);
  const [filterEnteredAfter, setFilterEnteredAfter] = useState('');
  const [selectedEntriesMap, setSelectedEntriesMap] = useState<Record<string, Set<string>>>({});
  const [existingWinnerEmailsMap, setExistingWinnerEmailsMap] = useState<Record<string, Set<string>>>({});
  const [winnerStatusMap, setWinnerStatusMap] = useState<Record<string, Record<string, string>>>({});
  const [updatingWinners, setUpdatingWinners] = useState(false);

  // Email modal state
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailEntry, setEmailEntry] = useState<CompetitionEntry | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailFromOption, setEmailFromOption] = useState('events');
  const [emailReplyTo, setEmailReplyTo] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  // Communication settings for winner email templates
  const [winnerEmailSettings, setWinnerEmailSettings] = useState<{
    winner_subject: string | null;
    winner_content: string | null;
    winner_from_key: string;
    winner_reply_to: string | null;
    followup_content: string | null;
    accepted_subject: string | null;
    accepted_content: string | null;
  } | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCompetition, setEditingCompetition] = useState<Competition | null>(null);
  const [formData, setFormData] = useState<CompetitionFormData>(emptyFormData);

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    competitionId: string | null;
    competitionTitle: string;
  }>({
    isOpen: false,
    competitionId: null,
    competitionTitle: '',
  });

  // Delete entry modal state
  const [deleteEntryModal, setDeleteEntryModal] = useState<{
    isOpen: boolean;
    entryId: string | null;
    entryEmail: string;
    competitionId: string | null;
  }>({
    isOpen: false,
    entryId: null,
    entryEmail: '',
    competitionId: null,
  });

  useEffect(() => {
    loadCompetitions();
    loadWinnerEmailSettings();
  }, [eventId]);

  const loadWinnerEmailSettings = async () => {
    try {
      const { data } = await supabase
        .from('event_communication_settings')
        .select('competition_winner_email_subject, competition_winner_email_content, competition_winner_email_from_key, competition_winner_email_reply_to, competition_winner_followup_email_content, competition_winner_accepted_email_subject, competition_winner_accepted_email_content')
        .eq('event_id', eventId)
        .maybeSingle();

      if (data) {
        setWinnerEmailSettings({
          winner_subject: data.competition_winner_email_subject,
          winner_content: data.competition_winner_email_content,
          winner_from_key: data.competition_winner_email_from_key || 'events',
          winner_reply_to: data.competition_winner_email_reply_to,
          followup_content: data.competition_winner_followup_email_content,
          accepted_subject: data.competition_winner_accepted_email_subject,
          accepted_content: data.competition_winner_accepted_email_content,
        });
      }
    } catch (error) {
      console.error('Error loading winner email settings:', error);
    }
  };

  const loadCompetitions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('event_competitions')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      const comps = data || [];
      setCompetitions(comps);

      // Load entry counts for all competitions
      const counts: Record<string, number> = {};
      await Promise.all(
        comps.map(async (comp) => {
          const { count } = await supabase
            .from('competition_entries')
            .select('*', { count: 'exact', head: true })
            .eq('competition_id', comp.id);
          counts[comp.id] = count || 0;
        })
      );
      setEntryCounts(counts);

      // Auto-expand all competitions and load their entries
      setExpandedIds(new Set(comps.map((c) => c.id)));
      comps.forEach((comp) => loadEntries(comp.id));
    } catch (error) {
      console.error('Error loading competitions:', error);
      toast.error('Failed to load competitions');
    } finally {
      setLoading(false);
    }
  };

  const loadEntries = async (competitionId: string) => {
    setLoadingEntriesMap((prev) => ({ ...prev, [competitionId]: true }));
    try {
      const { data: entriesData, error } = await supabase
        .from('competition_entries')
        .select('*')
        .eq('competition_id', competitionId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch profile data via member_profiles -> customers -> attributes
      const entriesWithProfiles = await Promise.all(
        (entriesData || []).map(async (entry) => {
          if (!entry.member_profile_id) {
            return { ...entry };
          }

          try {
            // Get member profile to find customer_id
            const { data: profile } = await supabase
              .from('member_profiles')
              .select('id, customer_id')
              .eq('id', entry.member_profile_id)
              .maybeSingle();

            if (profile?.customer_id) {
              const { data: customer } = await supabase
                .from('customers')
                .select('id, attributes')
                .eq('id', profile.customer_id)
                .maybeSingle();

              if (customer?.attributes) {
                const attrs = customer.attributes as Record<string, any>;
                return {
                  ...entry,
                  first_name: attrs.first_name || '',
                  last_name: attrs.last_name || '',
                  company: attrs.company || '',
                  job_title: attrs.job_title || '',
                  city: attrs.city || '',
                  state: attrs.state || '',
                };
              }
            }
          } catch {
            // Profile fetch failed (e.g. CORS) — continue with basic entry data
          }

          return { ...entry };
        })
      );

      setEntriesMap((prev) => ({ ...prev, [competitionId]: entriesWithProfiles }));

      // Fetch existing winners to pre-check their checkboxes and track notified status
      const { data: winnersData } = await supabase
        .from('competition_winners')
        .select('email, status')
        .eq('competition_id', competitionId)
        .eq('event_id', eventId);

      if (winnersData && winnersData.length > 0) {
        const winnerEmails = new Set(winnersData.map((w: { email: string }) => w.email));
        setExistingWinnerEmailsMap((prev) => ({ ...prev, [competitionId]: winnerEmails }));
        // Pre-select entries whose email matches an existing winner
        const preSelectedIds = new Set(
          entriesWithProfiles
            .filter((e) => winnerEmails.has(e.email))
            .map((e) => e.id)
        );
        setSelectedEntriesMap((prev) => ({ ...prev, [competitionId]: preSelectedIds }));

        // Track winner statuses by email
        const statusByEmail: Record<string, string> = {};
        winnersData.forEach((w: { email: string; status: string }) => {
          statusByEmail[w.email] = w.status;
        });
        setWinnerStatusMap((prev) => ({ ...prev, [competitionId]: statusByEmail }));
      }
    } catch (error) {
      console.error('Error loading entries:', error);
      toast.error('Failed to load competition entries');
    } finally {
      setLoadingEntriesMap((prev) => ({ ...prev, [competitionId]: false }));
    }
  };

  const handleToggleExpand = (competitionId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(competitionId)) {
        next.delete(competitionId);
      } else {
        next.add(competitionId);
        if (!entriesMap[competitionId]) {
          loadEntries(competitionId);
        }
      }
      return next;
    });
  };

  const getFilteredEntries = (competitionId: string) => {
    const entries = entriesMap[competitionId] || [];
    const statuses = winnerStatusMap[competitionId] || {};
    return entries.filter((entry) => {
      if (filterJobTitles.length > 0 && !filterJobTitles.includes(entry.job_title || '')) return false;
      if (filterCities.length > 0 && !filterCities.includes(entry.city || '')) return false;
      if (filterStates.length > 0 && !filterStates.includes(entry.state || '')) return false;
      const isWinner = !!statuses[entry.email];
      if (filterWinnerType === 'winners' && !isWinner) return false;
      if (filterWinnerType === 'non-winners' && isWinner) return false;
      if (filterWinnerStatuses.length > 0 && (!isWinner || !filterWinnerStatuses.includes(statuses[entry.email]))) return false;
      if (filterEnteredAfter && entry.entered_at && new Date(entry.entered_at) < new Date(filterEnteredAfter)) return false;
      return true;
    });
  };

  const getUniqueValues = (competitionId: string) => {
    const entries = entriesMap[competitionId] || [];
    return {
      jobTitles: [...new Set(entries.map(e => e.job_title).filter(Boolean))].sort() as string[],
      cities: [...new Set(entries.map(e => e.city).filter(Boolean))].sort() as string[],
      states: [...new Set(entries.map(e => e.state).filter(Boolean))].sort() as string[],
    };
  };

  const handleToggleEntrySelection = (competitionId: string, entryId: string) => {
    setSelectedEntriesMap((prev) => {
      const current = prev[competitionId] || new Set();
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return { ...prev, [competitionId]: next };
    });
  };

  const handleToggleSelectAll = (competitionId: string, filteredEntries: CompetitionEntry[]) => {
    setSelectedEntriesMap((prev) => {
      const current = prev[competitionId] || new Set();
      const allFilteredIds = filteredEntries.map((e) => e.id);
      const allSelected = allFilteredIds.every((id) => current.has(id));
      if (allSelected) {
        // Deselect all filtered
        const next = new Set(current);
        allFilteredIds.forEach((id) => next.delete(id));
        return { ...prev, [competitionId]: next };
      } else {
        // Select all filtered
        const next = new Set(current);
        allFilteredIds.forEach((id) => next.add(id));
        return { ...prev, [competitionId]: next };
      }
    });
  };

  const handleUpdateWinners = async (competition: Competition) => {
    const selected = selectedEntriesMap[competition.id] || new Set<string>();
    const compEntries = entriesMap[competition.id] || [];
    const existingWinnerEmails = existingWinnerEmailsMap[competition.id] || new Set<string>();

    // Build set of currently selected emails
    const selectedEmails = new Set(
      compEntries.filter((e) => selected.has(e.id)).map((e) => e.email)
    );

    // Compute diff
    const toAdd = [...selectedEmails].filter((email) => !existingWinnerEmails.has(email));
    const toRemove = [...existingWinnerEmails].filter((email) => !selectedEmails.has(email));

    if (toAdd.length === 0 && toRemove.length === 0) {
      toast.info('No changes to update');
      return;
    }

    setUpdatingWinners(true);
    try {
      // Insert new winners
      if (toAdd.length > 0) {
        const winnersToInsert = toAdd.map((email) => ({
          email,
          event_id: eventId,
          competition_id: competition.id,
          status: 'selected',
        }));

        const { error } = await supabase
          .from('competition_winners')
          .insert(winnersToInsert);

        if (error) throw error;
      }

      // Remove deselected winners
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('competition_winners')
          .delete()
          .eq('competition_id', competition.id)
          .eq('event_id', eventId)
          .in('email', toRemove);

        if (error) throw error;
      }

      // Update local existing winners state
      setExistingWinnerEmailsMap((prev) => ({
        ...prev,
        [competition.id]: new Set(selectedEmails),
      }));

      const parts: string[] = [];
      if (toAdd.length > 0) parts.push(`${toAdd.length} added`);
      if (toRemove.length > 0) parts.push(`${toRemove.length} removed`);
      toast.success(`Winners updated: ${parts.join(', ')}`);
    } catch (error) {
      console.error('Error updating winners:', error);
      toast.error('Failed to update winners');
    } finally {
      setUpdatingWinners(false);
    }
  };

  const fromAddresses = EmailService.getFromAddresses();
  const fromOptions = useMemo(() => {
    const options: { label: string; value: string }[] = [];
    if (fromAddresses.events) options.push({ label: `Events (${fromAddresses.events})`, value: 'events' });
    if (fromAddresses.default) options.push({ label: `Default (${fromAddresses.default})`, value: 'default' });
    if (fromAddresses.admin) options.push({ label: `Admin (${fromAddresses.admin})`, value: 'admin' });
    if (fromAddresses.members) options.push({ label: `Members (${fromAddresses.members})`, value: 'members' });
    if (fromAddresses.partners) options.push({ label: `Partners (${fromAddresses.partners})`, value: 'partners' });
    return options;
  }, [fromAddresses]);

  const getFromAddress = () => {
    return fromAddresses[emailFromOption as keyof typeof fromAddresses] || '';
  };

  const generateWinnerEmailContent = (entry: CompetitionEntry) => {
    const firstName = entry.first_name || 'there';
    const ticketType = offerTicketDetails || 'a free ticket';
    const prizeDescription = ticketType.toLowerCase().includes('ticket')
      ? ticketType.toLowerCase()
      : `a ${ticketType.toLowerCase()}`;

    const getEventDateText = () => {
      if (!eventStart) return '';
      // Parse just the date portion (YYYY-MM-DD) to avoid UTC timezone shifts
      const parseLocalDate = (dateStr: string) => {
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return new Date(dateStr);
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      };
      const formatDate = (date: Date) =>
        date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      const startDate = parseLocalDate(eventStart);

      // For multi-day events, show a range — but skip if end is just the next
      // calendar day (single-evening events often cross midnight in UTC)
      if (eventEnd) {
        const endDate = parseLocalDate(eventEnd);
        const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 1) {
          return ` on ${formatDate(startDate)} - ${formatDate(endDate)}`;
        }
      }

      return ` on ${formatDate(startDate)}`;
    };

    const title = eventTitle || 'the event';
    const tomorrowDay = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long' });

    const subject = `You've won ${prizeDescription} to ${title}`;
    const body = `<p>Hey ${firstName},</p>
<p>Congrats! You've won ${prizeDescription} to ${title}${getEventDateText()}.</p>
<p>Just reply to this email to confirm that you're able to attend. Once we've got your confirmation, we'll get your pass sorted.</p>
<p>As some past competition prizes have gone unclaimed, we kindly ask that you respond by end of day tomorrow (${tomorrowDay}). If we don't hear back by then, we may need to select a new winner.</p>
<p>Once everything is finalized, we'll announce it on our socials and tag you - feel free to share the news as well! If you post from the event, don't forget to tag us so we can reshare your posts!</p>
<p>Thanks again for entering!</p>
<p>Cheers<br/>Dan</p>`;

    return { subject, body };
  };

  const generateFollowUpEmailContent = (entry: CompetitionEntry) => {
    const firstName = entry.first_name || 'there';
    const title = eventTitle || 'the conference';

    const getDateText = () => {
      if (!eventStart) return '';
      const parseLocalDate = (dateStr: string) => {
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return new Date(dateStr);
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      };
      const formatDate = (date: Date) =>
        date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const startDate = parseLocalDate(eventStart);
      if (eventEnd) {
        const endDate = parseLocalDate(eventEnd);
        const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 1) return `${formatDate(startDate)} - ${formatDate(endDate)}`;
      }
      return formatDate(startDate);
    };

    const subject = `Your ticket to ${title}`;
    const body = `<p>Hey ${firstName},</p>
<p>I've still got a ticket available for you. Can you make it to the conference on ${getDateText()}?</p>
<p>Cheers<br/>Dan</p>`;

    return { subject, body };
  };

  const generateAcceptedColleagueEmailContent = (entry: CompetitionEntry) => {
    const firstName = entry.first_name || 'there';
    const title = eventTitle || 'the conference';

    const subject = `Free tickets to ${title}`;
    const body = `<p>Hey ${firstName},</p>
<p>We've managed to secure a few more free tickets to the event. Do you have any colleagues that may be interested?</p>
<p>They can use this discount code to register: <strong>TTPLUS1-ERCD-3285</strong></p>
<p>Cheers<br/>Dan</p>`;

    return { subject, body };
  };

  // Replace template variables in winner email content
  const replaceWinnerVariables = (text: string, entry: CompetitionEntry, competitionTitle?: string) => {
    const formatEventDate = () => {
      if (!eventStart) return '';
      const parseLocalDate = (dateStr: string) => {
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return new Date(dateStr);
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      };
      const fmtDate = (date: Date) =>
        date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const startDate = parseLocalDate(eventStart);
      if (eventEnd) {
        const endDate = parseLocalDate(eventEnd);
        const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 1) return `${fmtDate(startDate)} - ${fmtDate(endDate)}`;
      }
      return fmtDate(startDate);
    };

    return text
      .replace(/\{\{customer\.first_name\}\}/g, entry.first_name || 'there')
      .replace(/\{\{customer\.last_name\}\}/g, entry.last_name || '')
      .replace(/\{\{customer\.email\}\}/g, entry.email || '')
      .replace(/\{\{event\.name\}\}/g, eventTitle || 'the event')
      .replace(/\{\{event\.date\}\}/g, formatEventDate())
      .replace(/\{\{competition\.title\}\}/g, competitionTitle || '');
  };

  const handleOpenEmailModal = (entry: CompetitionEntry, winnerStatus?: string) => {
    // Find the competition title for this entry
    const competition = competitions.find(c => c.id === entry.competition_id);
    const competitionTitle = competition?.title || '';

    let subject: string;
    let body: string;
    let fromKey = 'events';
    let replyTo = '';

    if (winnerStatus === 'accepted' && winnerEmailSettings?.accepted_content) {
      // Use configured accepted template
      subject = winnerEmailSettings.accepted_subject
        ? replaceWinnerVariables(winnerEmailSettings.accepted_subject, entry, competitionTitle)
        : `Re: ${replaceWinnerVariables(winnerEmailSettings.winner_subject || '', entry, competitionTitle)}`;
      body = replaceWinnerVariables(winnerEmailSettings.accepted_content, entry, competitionTitle);
      fromKey = winnerEmailSettings.winner_from_key || 'events';
      replyTo = winnerEmailSettings.winner_reply_to || '';
    } else if (winnerStatus === 'notified' && winnerEmailSettings?.followup_content) {
      // Use configured follow-up template with "Re: " + winner subject
      const winnerSubject = winnerEmailSettings.winner_subject
        ? replaceWinnerVariables(winnerEmailSettings.winner_subject, entry, competitionTitle)
        : '';
      subject = winnerSubject ? `Re: ${winnerSubject}` : '';
      body = replaceWinnerVariables(winnerEmailSettings.followup_content, entry, competitionTitle);
      fromKey = winnerEmailSettings.winner_from_key || 'events';
      replyTo = winnerEmailSettings.winner_reply_to || '';
    } else if (winnerStatus !== 'notified' && winnerStatus !== 'accepted' && winnerEmailSettings?.winner_content) {
      // Use configured winner notification template
      subject = winnerEmailSettings.winner_subject
        ? replaceWinnerVariables(winnerEmailSettings.winner_subject, entry, competitionTitle)
        : '';
      body = replaceWinnerVariables(winnerEmailSettings.winner_content, entry, competitionTitle);
      fromKey = winnerEmailSettings.winner_from_key || 'events';
      replyTo = winnerEmailSettings.winner_reply_to || '';
    } else {
      // Fall back to hardcoded generators
      let content: { subject: string; body: string };
      if (winnerStatus === 'accepted') {
        content = generateAcceptedColleagueEmailContent(entry);
      } else if (winnerStatus === 'notified') {
        content = generateFollowUpEmailContent(entry);
      } else {
        content = generateWinnerEmailContent(entry);
      }
      subject = content.subject;
      body = content.body;
    }

    setEmailEntry(entry);
    setEmailSubject(subject);
    setEmailBody(body);
    setEmailFromOption(fromKey);
    setEmailReplyTo(replyTo);
    setEmailModalOpen(true);
  };

  const handleSendEmail = async () => {
    if (!emailEntry) return;

    const fromAddress = getFromAddress();
    if (!fromAddress) {
      toast.error('Please select a from address');
      return;
    }

    if (!emailSubject.trim()) {
      toast.error('Please enter a subject');
      return;
    }

    if (!emailBody.trim()) {
      toast.error('Please enter a message');
      return;
    }

    setIsSendingEmail(true);
    try {
      const result = await EmailService.sendEmail({
        to: emailEntry.email,
        from: fromAddress,
        subject: emailSubject,
        html: emailBody,
        replyTo: emailReplyTo.trim() || undefined,
      });

      if (result.success) {
        toast.success(`Email sent to ${emailEntry.email}`);
        const compId = emailEntry.competition_id;
        const currentStatus = (winnerStatusMap[compId] || {})[emailEntry.email];
        // Only update status to 'notified' for first-time sends (selected → notified)
        if (currentStatus === 'selected') {
          await supabase
            .from('competition_winners')
            .update({ status: 'notified', notified_at: new Date().toISOString() })
            .eq('competition_id', compId)
            .eq('event_id', eventId)
            .eq('email', emailEntry.email);
          setWinnerStatusMap((prev) => ({
            ...prev,
            [compId]: { ...(prev[compId] || {}), [emailEntry.email]: 'notified' },
          }));
        }
        setEmailModalOpen(false);
        setEmailEntry(null);
      } else {
        toast.error(result.error || 'Failed to send email');
      }
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast.error(error.message || 'Failed to send email');
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleAddClick = () => {
    setEditingCompetition(null);
    setFormData(emptyFormData);
    setModalOpen(true);
  };

  const handleEditClick = (competition: Competition) => {
    setEditingCompetition(competition);
    setFormData({
      title: competition.title || '',
      slug: competition.slug || '',
      value: competition.value || '',
      close_date: competition.close_date
        ? competition.close_date.slice(0, 16)
        : '',
      close_display: competition.close_display || '',
      intro: competition.intro || '',
      content: competition.content || '',
      status: competition.status || 'active',
      is_beta: competition.is_beta || false,
    });
    setModalOpen(true);
  };

  const handleDeleteClick = (competitionId: string, title: string) => {
    setDeleteModal({
      isOpen: true,
      competitionId,
      competitionTitle: title,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.competitionId) return;

    try {
      const { error } = await supabase
        .from('event_competitions')
        .delete()
        .eq('id', deleteModal.competitionId);

      if (error) throw error;

      setCompetitions(competitions.filter((c) => c.id !== deleteModal.competitionId));
      const newCounts = { ...entryCounts };
      delete newCounts[deleteModal.competitionId];
      setEntryCounts(newCounts);

      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteModal.competitionId!);
        return next;
      });
      setEntriesMap((prev) => {
        const next = { ...prev };
        delete next[deleteModal.competitionId!];
        return next;
      });

      toast.success('Competition deleted successfully');
      setDeleteModal({ isOpen: false, competitionId: null, competitionTitle: '' });
    } catch (error) {
      console.error('Error deleting competition:', error);
      toast.error('Failed to delete competition');
    }
  };

  const handleDeleteEntry = (entryId: string, email: string, competitionId: string) => {
    setDeleteEntryModal({
      isOpen: true,
      entryId,
      entryEmail: email,
      competitionId,
    });
  };

  const handleDeleteEntryConfirm = async () => {
    if (!deleteEntryModal.entryId || !deleteEntryModal.competitionId) return;
    const compId = deleteEntryModal.competitionId;

    try {
      const { error } = await supabase
        .from('competition_entries')
        .delete()
        .eq('id', deleteEntryModal.entryId);

      if (error) throw error;

      // Remove from local state
      setEntriesMap((prev) => ({
        ...prev,
        [compId]: (prev[compId] || []).filter((e) => e.id !== deleteEntryModal.entryId),
      }));

      // Update entry count
      const currentCount = entryCounts[compId] || 0;
      setEntryCounts({
        ...entryCounts,
        [compId]: Math.max(0, currentCount - 1),
      });

      toast.success('Entry deleted successfully');
      setDeleteEntryModal({ isOpen: false, entryId: null, entryEmail: '', competitionId: null });
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast.error('Failed to delete entry');
    }
  };

  const handleExportCSV = (competition: Competition) => {
    const columns = ['email', 'first_name', 'last_name', 'job_title', 'company', 'city', 'state', 'status', 'entered_at'];
    const csvHeader = columns.join(',');
    const compEntries = getFilteredEntries(competition.id);

    const csvRows = compEntries.map((entry) => {
      const row = [
        entry.email || '',
        entry.first_name || '',
        entry.last_name || '',
        entry.job_title || '',
        entry.company || '',
        entry.city || '',
        entry.state || '',
        entry.status || '',
        entry.entered_at ? new Date(entry.entered_at).toISOString() : '',
      ];

      return row.map((field) => {
        const fieldStr = String(field);
        if (fieldStr.includes(',') || fieldStr.includes('"') || fieldStr.includes('\n')) {
          return `"${fieldStr.replace(/"/g, '""')}"`;
        }
        return fieldStr;
      }).join(',');
    });

    const csvContent = [csvHeader, ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `competition_entries_${competition.title.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!formData.slug.trim()) {
      toast.error('Slug is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: formData.title.trim(),
        slug: formData.slug.trim(),
        value: formData.value.trim() || null,
        close_date: formData.close_date || null,
        close_display: formData.close_display.trim() || null,
        intro: formData.intro.trim() || null,
        content: formData.content.trim() || null,
        status: formData.status,
        is_beta: formData.is_beta,
      };

      if (editingCompetition) {
        const { data, error } = await supabase
          .from('event_competitions')
          .update(payload)
          .eq('id', editingCompetition.id)
          .select()
          .single();

        if (error) throw error;

        setCompetitions(
          competitions.map((c) => (c.id === editingCompetition.id ? data : c))
        );
        toast.success('Competition updated successfully');
      } else {
        const { data, error } = await supabase
          .from('event_competitions')
          .insert({ ...payload, event_id: eventId })
          .select()
          .single();

        if (error) throw error;

        setCompetitions([...competitions, data]);
        setEntryCounts({ ...entryCounts, [data.id]: 0 });
        toast.success('Competition created successfully');
      }

      setModalOpen(false);
      setEditingCompetition(null);
      setFormData(emptyFormData);
    } catch (error) {
      console.error('Error saving competition:', error);
      toast.error('Failed to save competition');
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge color="success">Active</Badge>;
      case 'closed':
        return <Badge color="neutral">Closed</Badge>;
      case 'cancelled':
        return <Badge color="error">Cancelled</Badge>;
      default:
        return <Badge color="neutral">{status}</Badge>;
    }
  };

  const getEntryStatusBadge = (status: string) => {
    switch (status) {
      case 'entered':
        return <Badge color="success">Entered</Badge>;
      case 'viewed':
        return <Badge color="info">Viewed</Badge>;
      case 'won':
        return <Badge color="warning">Won</Badge>;
      default:
        return <Badge color="neutral">{status}</Badge>;
    }
  };

  const getWinnerStatusBadge = (status: string) => {
    switch (status) {
      case 'selected':
        return <Badge color="warning">Selected</Badge>;
      case 'notified':
        return <Badge color="info">Notified</Badge>;
      case 'accepted':
        return <Badge color="success">Accepted</Badge>;
      case 'declined':
        return <Badge color="error">Declined</Badge>;
      case 'not_replied':
        return <Badge color="neutral">Not Replied</Badge>;
      default:
        return <Badge color="neutral">{status}</Badge>;
    }
  };

  const handleWinnerStatusChange = async (competitionId: string, email: string, newStatus: string) => {
    try {
      const timestampField = `${newStatus}_at`;
      const updateData: Record<string, any> = {
        status: newStatus,
        [timestampField]: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('competition_winners')
        .update(updateData)
        .eq('competition_id', competitionId)
        .eq('event_id', eventId)
        .eq('email', email);

      if (error) throw error;

      setWinnerStatusMap((prev) => ({
        ...prev,
        [competitionId]: { ...(prev[competitionId] || {}), [email]: newStatus },
      }));
      toast.success(`Winner status updated to ${newStatus.replace('_', ' ')}`);
    } catch (error) {
      console.error('Error updating winner status:', error);
      toast.error('Failed to update winner status');
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="p-6 flex justify-center">
          <LoadingSpinner size="medium" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Competitions ({competitions.length})
          </h3>
          <Button variant="primary" size="small" onClick={handleAddClick}>
            <PlusIcon className="w-4 h-4 mr-1" />
            Add Competition
          </Button>
        </div>

        {competitions.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <TrophyIcon className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p>No competitions yet</p>
            <p className="text-sm mt-1">
              Create a competition for this event to get started
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {competitions.map((competition) => (
              <div
                key={competition.id}
                className="border border-gray-200 dark:border-dark-300 rounded-lg overflow-hidden"
              >
                {/* Competition card header */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-surface-2 transition-colors"
                  onClick={() => handleToggleExpand(competition.id)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-white truncate">
                          {competition.title}
                        </span>
                        {getStatusBadge(competition.status)}
                        {competition.is_beta && (
                          <Badge color="info" variant="outlined">
                            Beta
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-dark-200">
                        <span>/{competition.slug}</span>
                        {competition.value && (
                          <span>{competition.value}</span>
                        )}
                        {competition.close_date && (
                          <span>
                            Closes:{' '}
                            {competition.close_display ||
                              new Date(competition.close_date).toLocaleDateString()}
                          </span>
                        )}
                        <span>
                          {entryCounts[competition.id] ?? 0}{' '}
                          {entryCounts[competition.id] === 1 ? 'entry' : 'entries'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        handleEditClick(competition);
                      }}
                      title="Edit"
                    >
                      <PencilIcon className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="danger"
                      size="small"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        handleDeleteClick(competition.id, competition.title);
                      }}
                      title="Delete"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </Button>
                    {expandedIds.has(competition.id) ? (
                      <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </div>

                {/* Expanded entries section */}
                {expandedIds.has(competition.id) && (() => {
                  const compEntries = entriesMap[competition.id] || [];
                  const filtered = getFilteredEntries(competition.id);
                  const unique = getUniqueValues(competition.id);
                  const isLoading = loadingEntriesMap[competition.id];

                  return (
                  <div className="border-t border-gray-200 dark:border-dark-300 bg-gray-50 dark:bg-surface-1 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-dark-100">
                        Entries ({filtered.length !== compEntries.length ? `${filtered.length} of ` : ''}{entryCounts[competition.id] ?? 0})
                      </h4>
                      <div className="flex items-center gap-2">
                        {compEntries.length > 0 && (
                          <Button
                            variant="primary"
                            size="small"
                            onClick={() => handleUpdateWinners(competition)}
                            disabled={updatingWinners}
                          >
                            <TrophyIcon className="w-4 h-4 mr-1" />
                            {updatingWinners ? 'Updating...' : 'Update Winners'}
                          </Button>
                        )}
                        {compEntries.length > 0 && (
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={() => handleExportCSV(competition)}
                          >
                            <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
                            Export CSV
                          </Button>
                        )}
                      </div>
                    </div>

                    {compEntries.length > 0 && (
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <select
                          className="text-xs border border-gray-300 dark:border-dark-400 rounded px-2 py-1 bg-white dark:bg-surface-2 text-gray-700 dark:text-dark-100"
                          value={filterWinnerType}
                          onChange={(e) => setFilterWinnerType(e.target.value as 'all' | 'winners' | 'non-winners')}
                        >
                          <option value="all">All Entrants</option>
                          <option value="winners">Winners Only</option>
                          <option value="non-winners">Non-Winners Only</option>
                        </select>
                        <MultiSelectFilter
                          label="Winner Status"
                          options={['selected', 'notified', 'accepted', 'declined', 'not_replied']}
                          selected={filterWinnerStatuses}
                          onChange={setFilterWinnerStatuses}
                        />
                        <MultiSelectFilter
                          label="Job Title"
                          options={unique.jobTitles}
                          selected={filterJobTitles}
                          onChange={setFilterJobTitles}
                        />
                        <MultiSelectFilter
                          label="City"
                          options={unique.cities}
                          selected={filterCities}
                          onChange={setFilterCities}
                        />
                        <MultiSelectFilter
                          label="State"
                          options={unique.states}
                          selected={filterStates}
                          onChange={setFilterStates}
                        />
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-gray-500 dark:text-dark-200 whitespace-nowrap">Entered after:</label>
                          <input
                            type="datetime-local"
                            className="text-xs border border-gray-300 dark:border-dark-400 rounded px-2 py-1 bg-white dark:bg-surface-2 text-gray-700 dark:text-dark-100"
                            value={filterEnteredAfter}
                            onChange={(e) => setFilterEnteredAfter(e.target.value)}
                          />
                        </div>
                        {(filterJobTitles.length > 0 || filterCities.length > 0 || filterStates.length > 0 || filterWinnerType !== 'all' || filterWinnerStatuses.length > 0 || filterEnteredAfter) && (
                          <button
                            onClick={() => { setFilterJobTitles([]); setFilterCities([]); setFilterStates([]); setFilterWinnerType('all'); setFilterWinnerStatuses([]); setFilterEnteredAfter(''); }}
                            className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            Clear all
                          </button>
                        )}
                      </div>
                    )}

                    {isLoading ? (
                      <div className="flex justify-center py-4">
                        <LoadingSpinner size="small" />
                      </div>
                    ) : compEntries.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-dark-200 text-center py-4">
                        No entries yet
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-dark-300">
                          <thead>
                            <tr>
                              <th className="px-3 py-2 w-8">
                                <input
                                  type="checkbox"
                                  checked={filtered.length > 0 && filtered.every((e) => (selectedEntriesMap[competition.id] || new Set()).has(e.id))}
                                  onChange={() => handleToggleSelectAll(competition.id, filtered)}
                                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                />
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                Email
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                First Name
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                Last Name
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                Company
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                Job Title
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                City
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                State
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                Status
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                Entered At
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                Winner Status
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-dark-300">
                            {filtered.map((entry) => (
                              <tr
                                key={entry.id}
                                className={
                                  (selectedEntriesMap[competition.id] || new Set()).has(entry.id)
                                    ? 'bg-primary-50 dark:bg-primary-900/20'
                                    : 'hover:bg-gray-100 dark:hover:bg-surface-2'
                                }
                              >
                                <td className="px-3 py-2 w-8">
                                  <input
                                    type="checkbox"
                                    checked={(selectedEntriesMap[competition.id] || new Set()).has(entry.id)}
                                    onChange={() => handleToggleEntrySelection(competition.id, entry.id)}
                                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                  />
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">
                                  {entry.email}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-700 dark:text-dark-100">
                                  {entry.first_name || '-'}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-700 dark:text-dark-100">
                                  {entry.last_name || '-'}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-700 dark:text-dark-100">
                                  {entry.company || '-'}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-700 dark:text-dark-100">
                                  {entry.job_title || '-'}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-700 dark:text-dark-100">
                                  {entry.city || '-'}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-700 dark:text-dark-100">
                                  {entry.state || '-'}
                                </td>
                                <td className="px-3 py-2 text-sm">
                                  {getEntryStatusBadge(entry.status)}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-500 dark:text-dark-200">
                                  {entry.entered_at
                                    ? new Date(entry.entered_at).toLocaleString()
                                    : '-'}
                                </td>
                                <td className="px-3 py-2 text-sm">
                                  {(() => {
                                    const winnerStatus = (winnerStatusMap[competition.id] || {})[entry.email];
                                    if (!winnerStatus) return <span className="text-gray-400 dark:text-dark-300">-</span>;
                                    return (
                                      <div className="flex items-center gap-2">
                                        {getWinnerStatusBadge(winnerStatus)}
                                        {winnerStatus === 'notified' && (
                                          <select
                                            className="text-xs border border-gray-300 dark:border-dark-400 rounded px-1 py-0.5 bg-white dark:bg-surface-2 text-gray-700 dark:text-dark-100"
                                            value=""
                                            onChange={(e) => {
                                              if (e.target.value) {
                                                handleWinnerStatusChange(competition.id, entry.email, e.target.value);
                                              }
                                            }}
                                          >
                                            <option value="">Change...</option>
                                            <option value="accepted">Accepted</option>
                                            <option value="declined">Declined</option>
                                            <option value="not_replied">Not Replied</option>
                                          </select>
                                        )}
                                        {winnerStatus === 'selected' && (
                                          <span className="text-xs text-gray-400 dark:text-dark-300">Awaiting email</span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td className="px-3 py-2 text-sm">
                                  <div className="flex items-center gap-1">
                                    {(() => {
                                      const winnerStatus = (winnerStatusMap[competition.id] || {})[entry.email];
                                      if (!winnerStatus) return null;
                                      if (winnerStatus === 'notified') {
                                        return (
                                          <button
                                            onClick={() => handleOpenEmailModal(entry, 'notified')}
                                            title="Send follow-up email"
                                            className="p-1 text-green-500 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                                          >
                                            <EnvelopeIcon className="w-4 h-4" />
                                          </button>
                                        );
                                      }
                                      if (winnerStatus === 'accepted') {
                                        return (
                                          <button
                                            onClick={() => handleOpenEmailModal(entry, 'accepted')}
                                            title="Invite colleague email"
                                            className="p-1 text-green-500 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                                          >
                                            <EnvelopeIcon className="w-4 h-4" />
                                          </button>
                                        );
                                      }
                                      if (winnerStatus === 'selected') {
                                        return (
                                          <button
                                            onClick={() => handleOpenEmailModal(entry, 'selected')}
                                            title="Email Winner"
                                            className="p-1 text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300"
                                          >
                                            <EnvelopeIcon className="w-4 h-4" />
                                          </button>
                                        );
                                      }
                                      return null;
                                    })()}
                                    {entry.member_profile_id && (
                                      <a
                                        href={`/members/${entry.member_profile_id}`}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          window.location.href = `/members/${entry.member_profile_id}`;
                                        }}
                                        title="View Profile"
                                        className="p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                      >
                                        <UserIcon className="w-4 h-4" />
                                      </a>
                                    )}
                                    <button
                                      onClick={() => handleDeleteEntry(entry.id, entry.email, competition.id)}
                                      title="Delete Entry"
                                      className="p-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                                    >
                                      <TrashIcon className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingCompetition(null);
          setFormData(emptyFormData);
        }}
        title={editingCompetition ? 'Edit Competition' : 'Add Competition'}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="outlined"
              onClick={() => {
                setModalOpen(false);
                setEditingCompetition(null);
                setFormData(emptyFormData);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingCompetition ? 'Update' : 'Create'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            value={formData.title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, title: e.target.value })
            }
            placeholder="Competition title"
          />

          <Input
            label="Slug"
            value={formData.slug}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, slug: e.target.value })
            }
            placeholder="competition-slug"
          />

          <Input
            label="Value"
            value={formData.value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, value: e.target.value })
            }
            placeholder="Worth $500"
          />

          <Input
            label="Close Date"
            type="datetime-local"
            value={formData.close_date}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, close_date: e.target.value })
            }
          />

          <Input
            label="Close Display"
            value={formData.close_display}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, close_display: e.target.value })
            }
            placeholder="e.g. Closes 31 March 2025"
          />

          <Textarea
            label="Intro"
            value={formData.intro}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setFormData({ ...formData, intro: e.target.value })
            }
            placeholder="Competition introduction text"
            rows={3}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Content
            </label>
            <RichTextEditor
              content={formData.content}
              onChange={(content: string) =>
                setFormData({ ...formData, content })
              }
              placeholder="Detailed competition content (rich text)"
            />
          </div>

          <Select
            label="Status"
            value={formData.status}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setFormData({ ...formData, status: e.target.value })
            }
            data={[
              { label: 'Active', value: 'active' },
              { label: 'Closed', value: 'closed' },
              { label: 'Cancelled', value: 'cancelled' },
            ]}
          />

          <Checkbox
            label="Beta"
            checked={formData.is_beta}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, is_beta: e.target.checked })
            }
          />
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteModal.isOpen}
        title="Delete Competition"
        message={`Are you sure you want to delete "${deleteModal.competitionTitle}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={handleDeleteConfirm}
        onClose={() =>
          setDeleteModal({ isOpen: false, competitionId: null, competitionTitle: '' })
        }
      />

      <ConfirmModal
        isOpen={deleteEntryModal.isOpen}
        title="Delete Entry"
        message={`Are you sure you want to delete the entry for "${deleteEntryModal.entryEmail}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={handleDeleteEntryConfirm}
        onClose={() =>
          setDeleteEntryModal({ isOpen: false, entryId: null, entryEmail: '', competitionId: null })
        }
      />

      {/* Email Winner Modal */}
      <Modal
        isOpen={emailModalOpen}
        onClose={() => {
          setEmailModalOpen(false);
          setEmailEntry(null);
        }}
        title={`Email ${emailEntry?.first_name ? `${emailEntry.first_name} ${emailEntry.last_name || ''}`.trim() : emailEntry?.email || 'Winner'}`}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="outlined"
              onClick={() => {
                setEmailModalOpen(false);
                setEmailEntry(null);
              }}
              disabled={isSendingEmail}
            >
              Cancel
            </Button>
            <Button
              variant="filled"
              onClick={handleSendEmail}
              disabled={isSendingEmail}
            >
              {isSendingEmail ? 'Sending...' : 'Send Email'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Recipient (read-only) */}
          <Input
            label="To"
            value={emailEntry?.email || ''}
            disabled
          />

          {/* From Address */}
          <Select
            label="From"
            value={emailFromOption}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEmailFromOption(e.target.value)}
            disabled={isSendingEmail}
            data={fromOptions}
          />

          {/* Reply To */}
          <Input
            label="Reply To (optional)"
            type="email"
            value={emailReplyTo}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmailReplyTo(e.target.value)}
            placeholder="reply@example.com"
            disabled={isSendingEmail}
          />

          {/* Subject */}
          <Input
            label="Subject"
            value={emailSubject}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmailSubject(e.target.value)}
            disabled={isSendingEmail}
          />

          {/* Message Body */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Message
            </label>
            <RichTextEditor
              content={emailBody}
              onChange={setEmailBody}
              placeholder="Enter your message..."
              editable={!isSendingEmail}
            />
          </div>
        </div>
      </Modal>
    </Card>
  );
};
