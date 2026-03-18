// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ClockIcon,
  MapPinIcon,
  UserIcon,
  XMarkIcon,
  Bars3Icon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { CheckIcon } from '@heroicons/react/24/solid';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Card, Input, Modal, ConfirmModal } from '@/components/ui-legacy';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { AgendaService, AgendaTrack, AgendaEntry, AgendaEntryType, TimelineConfig, AgendaEntryPosition } from '@/utils/agendaService';
import { SpeakerService, EventSpeakerWithDetails } from '@/utils/speakerService';
import { TalkService, EventTalkWithSpeakers, SessionType, TalkStatus, SpeakerRole } from '@/utils/talkService';

export interface TalkDurationOption {
  duration: number;  // minutes
  capacity: number;  // max number of talks
}

type AgendaViewMode = 'list' | 'timeline';

interface EventAgendaTabProps {
  eventUuid: string; // The UUID (events.id), not the event code (events.event_id)
  eventStart?: string; // Event start date/time for auto-filling agenda entries
  eventEnd?: string; // Event end date/time for timeline bounds
  talkDurationOptions?: TalkDurationOption[] | null;
  onTalkDurationOptionsChange?: (options: TalkDurationOption[]) => void;
}

interface TrackFormData {
  name: string;
  description: string;
}

interface EntryFormData {
  track_id: string;
  start_time: string;
  end_time: string;
  title: string;
  description: string;
  location: string;
  speaker_ids: string[];
  entry_type: AgendaEntryType;
  talk_id: string;
}

// Sortable entry component for drag and drop
interface SortableEntryProps {
  entry: AgendaEntry;
  speakers: EventSpeakerWithDetails[];
  linkedTalk?: EventTalkWithSpeakers;
  onEdit: (entry: AgendaEntry) => void;
  onDelete: (entry: AgendaEntry) => void;
  onSpeakerClick: (speaker: EventSpeakerWithDetails) => void;
  formatTime: (dateString: string) => string;
  isDragging?: boolean;
}

function SortableEntry({
  entry,
  speakers,
  linkedTalk,
  onEdit,
  onDelete,
  onSpeakerClick,
  formatTime,
  isDragging = false,
}: SortableEntryProps) {
  // Determine if the linked talk has a status that needs attention
  const needsAttention = linkedTalk && !['confirmed', 'approved'].includes(linkedTalk.status);
  const statusConfig: Record<string, { bg: string; text: string; label: string; border: string; iconBg: string }> = {
    pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', label: 'Pending Review', border: 'border-yellow-400 ring-2 ring-yellow-400/30', iconBg: 'bg-yellow-400' },
    rejected: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Rejected', border: 'border-red-400 ring-2 ring-red-400/30', iconBg: 'bg-red-500' },
    reserve: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', label: 'Reserve', border: 'border-purple-400 ring-2 ring-purple-400/30', iconBg: 'bg-purple-500' },
    draft: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-300', label: 'Draft', border: 'border-gray-400 ring-2 ring-gray-400/30', iconBg: 'bg-gray-500' },
  };

  // Use talk speakers if available, otherwise fall back to entry speakers
  const displaySpeakers = linkedTalk?.speakers?.length
    ? linkedTalk.speakers.map(ts => ({
        id: ts.speaker_id,
        full_name: ts.full_name,
        email: ts.email,
        avatar_url: ts.avatar_url,
      } as EventSpeakerWithDetails))
    : speakers;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: entry.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };

  const statusStyle = needsAttention && linkedTalk ? statusConfig[linkedTalk.status] : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group border rounded-lg p-4 transition-all duration-200 relative ${
        isDragging || isSortableDragging
          ? 'border-primary-400 bg-primary-50/50 dark:bg-primary-900/20 shadow-lg ring-2 ring-primary-400/30'
          : needsAttention && statusStyle
          ? `${statusStyle.border} bg-white dark:bg-gray-900`
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-900'
      }`}
    >
      {/* Warning indicator for talks needing attention */}
      {needsAttention && linkedTalk && statusStyle && (
        <div
          className={`absolute -top-2 -right-2 w-6 h-6 rounded-full ${statusStyle.iconBg} flex items-center justify-center shadow-md z-10 animate-pulse`}
          title={`Talk status: ${linkedTalk.status}`}
        >
          <ExclamationTriangleIcon className="w-4 h-4 text-white" />
        </div>
      )}
      <div className="flex items-start gap-3">
        {/* Drag Handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 p-1.5 -ml-1 rounded-md cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
          title="Drag to reorder"
        >
          <Bars3Icon className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white flex-1">
              {entry.title}
            </h4>
            {needsAttention && linkedTalk && statusStyle && (
              <span
                className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${statusStyle.bg} ${statusStyle.text}`}
                title={`This entry's linked talk has status: ${linkedTalk.status}`}
              >
                <ExclamationTriangleIcon className="w-3 h-3" />
                {statusStyle.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1">
              <ClockIcon className="w-4 h-4" />
              <span>
                {formatTime(entry.start_time)} - {formatTime(entry.end_time)}
              </span>
            </div>
            {entry.location && (
              <div className="flex items-center gap-1">
                <MapPinIcon className="w-4 h-4" />
                <span>{entry.location}</span>
              </div>
            )}
          </div>
          {entry.description && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 line-clamp-2">
              {entry.description}
            </p>
          )}
          {/* Speakers */}
          {displaySpeakers.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {displaySpeakers.map((speaker) => (
                <button
                  key={speaker.id}
                  type="button"
                  onClick={() => onSpeakerClick(speaker)}
                  className="flex items-center gap-1.5 px-2 py-1 bg-primary-50 dark:bg-primary-900/20 rounded-full hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors cursor-pointer"
                >
                  {speaker.avatar_url ? (
                    <img
                      src={speaker.avatar_url}
                      alt={speaker.full_name || 'Speaker'}
                      className="w-4 h-4 rounded-full object-cover"
                    />
                  ) : (
                    <UserIcon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                  )}
                  <span className="text-xs font-medium text-primary-700 dark:text-primary-300">
                    {speaker.full_name || speaker.email}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(entry)}
            className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
            title="Edit entry"
          >
            <PencilIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(entry)}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
            title="Delete entry"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Drag overlay component (shown while dragging)
function DragOverlayEntry({
  entry,
  formatTime,
}: {
  entry: AgendaEntry;
  formatTime: (dateString: string) => string;
}) {
  return (
    <div className="border-2 border-primary-500 bg-white dark:bg-gray-900 rounded-lg p-4 shadow-2xl ring-4 ring-primary-500/20 rotate-2 scale-105">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-1.5 -ml-1 text-primary-500">
          <Bars3Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white">
            {entry.title}
          </h4>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1">
              <ClockIcon className="w-4 h-4" />
              <span>
                {formatTime(entry.start_time)} - {formatTime(entry.end_time)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Draggable timeline entry block
interface DraggableTimelineEntryProps {
  pos: AgendaEntryPosition;
  entrySpeakers: EventSpeakerWithDetails[];
  linkedTalk?: EventTalkWithSpeakers;
  onEdit: (entry: AgendaEntry) => void;
  onDelete: (entry: AgendaEntry) => void;
  formatTime: (dateString: string) => string;
  getEntryTypeClasses: (entryType: AgendaEntryType) => string;
  isDragging?: boolean;
}

function DraggableTimelineEntry({
  pos,
  entrySpeakers,
  linkedTalk,
  onEdit,
  onDelete,
  formatTime,
  getEntryTypeClasses,
  isDragging = false,
}: DraggableTimelineEntryProps) {
  // Use talk speakers if available, otherwise fall back to entry speakers
  const displaySpeakers = linkedTalk?.speakers?.length ? linkedTalk.speakers : entrySpeakers;

  // Determine if the linked talk has a status that needs attention
  const needsAttention = linkedTalk && !['confirmed', 'approved'].includes(linkedTalk.status);
  const statusColors: Record<string, { border: string; bg: string; icon: string }> = {
    pending: { border: 'ring-2 ring-yellow-400', bg: 'bg-yellow-400', icon: 'text-yellow-900' },
    rejected: { border: 'ring-2 ring-red-400', bg: 'bg-red-500', icon: 'text-white' },
    reserve: { border: 'ring-2 ring-purple-400', bg: 'bg-purple-500', icon: 'text-white' },
    draft: { border: 'ring-2 ring-gray-400', bg: 'bg-gray-500', icon: 'text-white' },
  };
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: pos.entry.id,
    data: {
      entry: pos.entry,
      trackId: pos.entry.track_id,
    },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        top: `${pos.top}px`,
        height: `${pos.height}px`,
        minHeight: '30px',
        zIndex: 50,
      }
    : {
        top: `${pos.top}px`,
        height: `${pos.height}px`,
        minHeight: '30px',
      };

  const statusStyle = needsAttention && linkedTalk ? statusColors[linkedTalk.status] : null;

  return (
    <div
      ref={setNodeRef}
      className={`absolute left-1 right-1 rounded-md border shadow-sm overflow-hidden cursor-grab active:cursor-grabbing group transition-shadow ${
        isDragging
          ? 'opacity-50 ring-2 ring-primary-400'
          : needsAttention && statusStyle
          ? statusStyle.border
          : 'hover:shadow-md'
      } ${getEntryTypeClasses(pos.entry.entry_type)}`}
      style={style}
      {...attributes}
      {...listeners}
    >
      {/* Warning indicator for talks needing attention */}
      {needsAttention && linkedTalk && statusStyle && (
        <div
          className={`absolute -top-1 -right-1 w-5 h-5 rounded-full ${statusStyle.bg} flex items-center justify-center shadow-md z-10 animate-pulse`}
          title={`Talk status: ${linkedTalk.status}`}
        >
          <ExclamationTriangleIcon className={`w-3 h-3 ${statusStyle.icon}`} />
        </div>
      )}
      <div className="p-1.5 h-full overflow-hidden">
        {pos.entry.entry_type === 'spacer' ? (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            {pos.entry.title || 'Spacer'}
          </div>
        ) : (
          <>
            <div className="flex items-start gap-1">
              <p className="text-xs font-medium text-gray-900 dark:text-white truncate flex-1">
                {pos.entry.title}
              </p>
            </div>
            {pos.height > 40 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {formatTime(pos.entry.start_time).split(',')[1]?.trim()}
              </p>
            )}
            {pos.height > 50 && displaySpeakers.length > 0 && (
              <div className="flex items-center gap-1 mt-1 overflow-hidden">
                {displaySpeakers.slice(0, 3).map((speaker, idx) => (
                  <div key={'speaker_id' in speaker ? speaker.speaker_id : speaker.id} className="flex items-center gap-0.5 min-w-0">
                    {('avatar_url' in speaker ? speaker.avatar_url : null) ? (
                      <img src={'avatar_url' in speaker ? speaker.avatar_url! : ''} alt="" className="w-3.5 h-3.5 rounded-full flex-shrink-0" />
                    ) : (
                      <UserIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    )}
                    {pos.height > 70 && (
                      <span className="text-[10px] text-gray-600 dark:text-gray-400 truncate">
                        {('full_name' in speaker ? speaker.full_name : null) || ('first_name' in speaker ? speaker.first_name : null) || ''}
                        {idx < displaySpeakers.slice(0, 3).length - 1 && displaySpeakers.length > 1 ? ',' : ''}
                      </span>
                    )}
                  </div>
                ))}
                {displaySpeakers.length > 3 && (
                  <span className="text-[10px] text-gray-500">+{displaySpeakers.length - 3}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {/* Action buttons on hover - stop propagation to prevent drag */}
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 flex gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(pos.entry); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="p-1 bg-white dark:bg-gray-800 rounded shadow text-gray-600 hover:text-primary-600"
        >
          <PencilIcon className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(pos.entry); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="p-1 bg-white dark:bg-gray-800 rounded shadow text-gray-600 hover:text-red-600"
        >
          <TrashIcon className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// Droppable timeline track column
interface DroppableTrackColumnProps {
  track: AgendaTrack;
  timelineHeight: number;
  timeSlots: { top: number; label: string }[];
  children: React.ReactNode;
  isOver: boolean;
}

function DroppableTrackColumn({
  track,
  timelineHeight,
  timeSlots,
  children,
  isOver,
}: DroppableTrackColumnProps) {
  const { setNodeRef } = useDroppable({
    id: `track-${track.id}`,
    data: {
      trackId: track.id,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={`relative border-l transition-colors ${
        isOver
          ? 'border-primary-400 bg-primary-50/30 dark:bg-primary-900/10'
          : 'border-gray-200 dark:border-gray-700'
      }`}
      style={{ height: `${timelineHeight}px` }}
    >
      {/* Hour grid lines */}
      {timeSlots.filter((_, i) => i % 2 === 0).map((slot, index) => (
        <div
          key={index}
          className="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-800"
          style={{ top: `${slot.top}px` }}
        />
      ))}

      {/* Drop indicator */}
      {isOver && (
        <div className="absolute inset-0 border-2 border-dashed border-primary-400 rounded-lg pointer-events-none z-10" />
      )}

      {children}
    </div>
  );
}

// Timeline drag overlay entry (shown while dragging in timeline view)
function TimelineDragOverlay({
  entry,
  height,
  getEntryTypeClasses,
}: {
  entry: AgendaEntry;
  height: number;
  getEntryTypeClasses: (entryType: AgendaEntryType) => string;
}) {
  return (
    <div
      className={`rounded-md border-2 border-primary-500 shadow-2xl ring-4 ring-primary-500/20 overflow-hidden ${getEntryTypeClasses(entry.entry_type)}`}
      style={{ width: '180px', height: `${Math.max(height, 40)}px` }}
    >
      <div className="p-1.5 h-full overflow-hidden">
        <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
          {entry.title}
        </p>
      </div>
    </div>
  );
}

// Droppable track card for list view sidebar
interface DroppableTrackCardProps {
  track: AgendaTrack;
  isSelected: boolean;
  isOver: boolean;
  entryCount: number;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function DroppableTrackCard({
  track,
  isSelected,
  isOver,
  entryCount,
  onSelect,
  onEdit,
  onDelete,
}: DroppableTrackCardProps) {
  const { setNodeRef } = useDroppable({
    id: `track-${track.id}`,
    data: {
      trackId: track.id,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
        isOver
          ? 'border-primary-500 bg-primary-100 dark:bg-primary-900/30 ring-2 ring-primary-400/50'
          : isSelected
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {track.name}
          </p>
          {track.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {track.description}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            {entryCount} entries
          </p>
          {isOver && (
            <p className="text-xs text-primary-600 dark:text-primary-400 mt-1 font-medium">
              Drop here to move
            </p>
          )}
        </div>
        <div className="flex gap-1 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1 text-gray-400 hover:text-primary-600"
          >
            <PencilIcon className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-gray-400 hover:text-red-600"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function EventAgendaTab({ eventUuid, eventStart, eventEnd, talkDurationOptions, onTalkDurationOptionsChange }: EventAgendaTabProps) {
  const [tracks, setTracks] = useState<AgendaTrack[]>([]);
  const [entries, setEntries] = useState<AgendaEntry[]>([]);
  const [speakers, setSpeakers] = useState<EventSpeakerWithDetails[]>([]);
  const [entrySpeakers, setEntrySpeakers] = useState<Record<string, EventSpeakerWithDetails[]>>({});
  const [loading, setLoading] = useState(true);
  const [showTrackModal, setShowTrackModal] = useState(false);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editingTrack, setEditingTrack] = useState<AgendaTrack | null>(null);
  const [editingEntry, setEditingEntry] = useState<AgendaEntry | null>(null);
  const [deletingTrack, setDeletingTrack] = useState<AgendaTrack | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<AgendaEntry | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<EventSpeakerWithDetails | null>(null);

  // Talks state (new multi-speaker talk system) - must be before useMemo that depends on it
  const [talks, setTalks] = useState<EventTalkWithSpeakers[]>([]);
  const [showTalkModal, setShowTalkModal] = useState(false);
  const [editingTalk, setEditingTalk] = useState<EventTalkWithSpeakers | null>(null);
  const [deletingTalk, setDeletingTalk] = useState<EventTalkWithSpeakers | null>(null);
  const [talkForm, setTalkForm] = useState({
    title: '',
    synopsis: '',
    duration_minutes: '' as string | number,
    session_type: 'talk' as SessionType,
    status: 'draft' as TalkStatus,
    speakers: [] as { speaker_id: string; role: SpeakerRole; is_primary: boolean }[],
  });

  // View mode state (list or timeline)
  const [viewMode, setViewMode] = useState<AgendaViewMode>('timeline');
  const [pixelsPerMinute, setPixelsPerMinute] = useState(2);

  // Timeline configuration (computed from event times and entries)
  const timelineConfig = useMemo<TimelineConfig>(() => {
    return AgendaService.createTimelineConfig(eventStart, eventEnd, entries, pixelsPerMinute);
  }, [eventStart, eventEnd, entries, pixelsPerMinute]);

  // Lookup map for talks by ID (for showing talk info on agenda entries)
  const talksById = useMemo(() => {
    const map: Record<string, EventTalkWithSpeakers> = {};
    for (const talk of talks) {
      map[talk.id] = talk;
    }
    return map;
  }, [talks]);

  // Available talks for scheduling (confirmed/approved talks not already in agenda)
  const availableTalks = useMemo(() => {
    const scheduledTalkIds = new Set(entries.filter(e => e.talk_id).map(e => e.talk_id));
    return talks.filter(t => (t.status === 'confirmed' || t.status === 'approved') && !scheduledTalkIds.has(t.id));
  }, [talks, entries]);

  // Time slots for timeline ruler
  const timeSlots = useMemo(() => {
    return AgendaService.generateTimeSlots(timelineConfig, 30);
  }, [timelineConfig]);

  // Timeline height
  const timelineHeight = useMemo(() => {
    return AgendaService.calculateTimelineHeight(timelineConfig);
  }, [timelineConfig]);

  // Entry positions grouped by track
  const entryPositionsByTrack = useMemo(() => {
    const grouped: Record<string, AgendaEntryPosition[]> = {};
    for (const track of tracks) {
      grouped[track.id] = entries
        .filter(e => e.track_id === track.id)
        .map(e => AgendaService.calculateEntryPosition(e, timelineConfig));
    }
    return grouped;
  }, [tracks, entries, timelineConfig]);

  // Talk Duration Options state
  const [durationOptions, setDurationOptions] = useState<TalkDurationOption[]>(
    talkDurationOptions || [{ duration: 10, capacity: 10 }, { duration: 25, capacity: 5 }]
  );
  const [showDurationModal, setShowDurationModal] = useState(false);
  const [editingDuration, setEditingDuration] = useState<TalkDurationOption | null>(null);
  const [durationForm, setDurationForm] = useState({ duration: '', capacity: '' });
  const [confirmedDurationCounts, setConfirmedDurationCounts] = useState<Record<number, number>>({});

  // Drag and drop state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [overTrackId, setOverTrackId] = useState<string | null>(null);

  // DnD sensors with activation constraints to prevent accidental drags
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const [trackForm, setTrackForm] = useState<TrackFormData>({
    name: '',
    description: '',
  });

  const [entryForm, setEntryForm] = useState<EntryFormData>({
    track_id: '',
    start_time: '',
    end_time: '',
    title: '',
    description: '',
    location: '',
    speaker_ids: [],
    entry_type: 'session',
    talk_id: '',
  });

  useEffect(() => {
    loadData();
  }, [eventUuid]);

  // Sync duration options from props
  useEffect(() => {
    if (talkDurationOptions) {
      setDurationOptions(talkDurationOptions);
    }
  }, [talkDurationOptions]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tracksData, entriesData, speakersData, durationCounts, talksData] = await Promise.all([
        AgendaService.getTracksByEvent(eventUuid),
        AgendaService.getEntriesByEvent(eventUuid),
        SpeakerService.getSpeakersByEvent(eventUuid),
        SpeakerService.getConfirmedDurationCounts(eventUuid),
        TalkService.getTalksByEvent(eventUuid),
      ]);
      setTracks(tracksData);
      setEntries(entriesData);
      setSpeakers(speakersData);
      setConfirmedDurationCounts(durationCounts);
      setTalks(talksData);

      // Load speakers for all entries
      if (entriesData.length > 0) {
        const entryIds = entriesData.map(e => e.id);
        const speakersMap = await SpeakerService.getSpeakersForAgendaEntries(entryIds);
        setEntrySpeakers(speakersMap);
      }

      // Set default selected track
      if (tracksData.length > 0 && !selectedTrackId) {
        setSelectedTrackId(tracksData[0].id);
      }
    } catch (error) {
      console.error('Error loading agenda data:', error);
      toast.error('Failed to load agenda data');
    } finally {
      setLoading(false);
    }
  };

  // ====== DURATION OPTION HANDLERS ======

  const handleAddDuration = () => {
    setEditingDuration(null);
    setDurationForm({ duration: '', capacity: '10' });
    setShowDurationModal(true);
  };

  const handleEditDuration = (option: TalkDurationOption) => {
    setEditingDuration(option);
    setDurationForm({
      duration: option.duration.toString(),
      capacity: option.capacity.toString(),
    });
    setShowDurationModal(true);
  };

  const handleSaveDuration = () => {
    const duration = parseInt(durationForm.duration, 10);
    const capacity = parseInt(durationForm.capacity, 10);

    if (isNaN(duration) || duration <= 0) {
      toast.error('Please enter a valid duration in minutes');
      return;
    }
    if (isNaN(capacity) || capacity <= 0) {
      toast.error('Please enter a valid capacity');
      return;
    }

    let newOptions: TalkDurationOption[];

    if (editingDuration) {
      // Update existing
      newOptions = durationOptions.map(opt =>
        opt.duration === editingDuration.duration
          ? { duration, capacity }
          : opt
      );
    } else {
      // Check for duplicate duration
      if (durationOptions.some(opt => opt.duration === duration)) {
        toast.error('A talk type with this duration already exists');
        return;
      }
      // Add new
      newOptions = [...durationOptions, { duration, capacity }];
    }

    // Sort by duration
    newOptions.sort((a, b) => a.duration - b.duration);

    setDurationOptions(newOptions);
    onTalkDurationOptionsChange?.(newOptions);
    setShowDurationModal(false);
    toast.success(editingDuration ? 'Talk type updated' : 'Talk type added');
  };

  const handleRemoveDuration = (option: TalkDurationOption) => {
    const confirmedCount = confirmedDurationCounts[option.duration] || 0;
    if (confirmedCount > 0) {
      toast.error(`Cannot remove: ${confirmedCount} confirmed talk(s) use this duration`);
      return;
    }

    const newOptions = durationOptions.filter(opt => opt.duration !== option.duration);
    setDurationOptions(newOptions);
    onTalkDurationOptionsChange?.(newOptions);
    toast.success('Talk type removed');
  };

  // ====== TALK HANDLERS ======

  const handleAddTalk = () => {
    setEditingTalk(null);
    setTalkForm({
      title: '',
      synopsis: '',
      duration_minutes: durationOptions[0]?.duration || '',
      session_type: 'talk',
      status: 'confirmed', // Default to confirmed for manually added sessions
      speakers: [],
    });
    setShowTalkModal(true);
  };

  const handleEditTalk = (talk: EventTalkWithSpeakers) => {
    setEditingTalk(talk);
    setTalkForm({
      title: talk.title,
      synopsis: talk.synopsis || '',
      duration_minutes: talk.duration_minutes || '',
      session_type: talk.session_type,
      status: talk.status,
      speakers: talk.speakers.map(s => ({
        speaker_id: s.speaker_id,
        role: s.role,
        is_primary: s.is_primary,
      })),
    });
    setShowTalkModal(true);
  };

  const handleSaveTalk = async () => {
    if (!talkForm.title.trim()) {
      toast.error('Title is required');
      return;
    }

    try {
      let talkId: string;

      if (editingTalk) {
        await TalkService.updateTalk(editingTalk.id, {
          title: talkForm.title,
          synopsis: talkForm.synopsis || undefined,
          duration_minutes: talkForm.duration_minutes ? Number(talkForm.duration_minutes) : undefined,
          session_type: talkForm.session_type,
          status: talkForm.status,
        });
        talkId = editingTalk.id;
        toast.success('Talk updated successfully');
      } else {
        const newTalk = await TalkService.createTalk({
          event_uuid: eventUuid,
          title: talkForm.title,
          synopsis: talkForm.synopsis || undefined,
          duration_minutes: talkForm.duration_minutes ? Number(talkForm.duration_minutes) : undefined,
          session_type: talkForm.session_type,
          status: talkForm.status,
        });
        talkId = newTalk.id;
        toast.success('Talk created successfully');
      }

      // Update speakers for this talk
      if (talkForm.speakers.length > 0) {
        await TalkService.updateTalkSpeakers(
          talkId,
          talkForm.speakers.map((s, index) => ({
            speaker_id: s.speaker_id,
            role: s.role,
            is_primary: s.is_primary || index === 0,
            sort_order: index,
          }))
        );
      }

      setShowTalkModal(false);
      loadData();
    } catch (error) {
      console.error('Error saving talk:', error);
      toast.error('Failed to save talk');
    }
  };

  const handleDeleteTalk = async () => {
    if (!deletingTalk) return;

    try {
      await TalkService.deleteTalk(deletingTalk.id);
      toast.success('Talk deleted successfully');
      setDeletingTalk(null);
      loadData();
    } catch (error) {
      console.error('Error deleting talk:', error);
      toast.error('Failed to delete talk');
    }
  };

  const handleTalkStatusChange = async (talk: EventTalkWithSpeakers, newStatus: TalkStatus) => {
    try {
      await TalkService.updateTalk(talk.id, { status: newStatus });
      toast.success(`Talk ${newStatus === 'confirmed' ? 'confirmed' : newStatus === 'approved' ? 'approved' : 'updated'}`);
      loadData();
    } catch (error) {
      console.error('Error updating talk status:', error);
      toast.error('Failed to update talk status');
    }
  };

  const toggleTalkSpeaker = (speakerId: string) => {
    const existingSpeaker = talkForm.speakers.find(s => s.speaker_id === speakerId);
    if (existingSpeaker) {
      setTalkForm({
        ...talkForm,
        speakers: talkForm.speakers.filter(s => s.speaker_id !== speakerId),
      });
    } else {
      setTalkForm({
        ...talkForm,
        speakers: [...talkForm.speakers, { speaker_id: speakerId, role: 'presenter' as SpeakerRole, is_primary: talkForm.speakers.length === 0 }],
      });
    }
  };

  const updateTalkSpeakerRole = (speakerId: string, role: SpeakerRole) => {
    setTalkForm({
      ...talkForm,
      speakers: talkForm.speakers.map(s =>
        s.speaker_id === speakerId ? { ...s, role } : s
      ),
    });
  };

  const getSessionTypeBadge = (sessionType: SessionType) => {
    const badges: Record<SessionType, { bg: string; text: string }> = {
      talk: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
      panel: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
      workshop: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
      lightning: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300' },
      fireside: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
      keynote: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
    };
    return badges[sessionType] || badges.talk;
  };

  const getStatusBadge = (status: TalkStatus) => {
    const badges: Record<TalkStatus, { bg: string; text: string }> = {
      draft: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400' },
      pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300' },
      approved: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
      rejected: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
      confirmed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
      reserve: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
    };
    return badges[status] || badges.draft;
  };

  // ====== TRACK HANDLERS ======

  const handleAddTrack = () => {
    setEditingTrack(null);
    setTrackForm({ name: '', description: '' });
    setShowTrackModal(true);
  };

  const handleEditTrack = (track: AgendaTrack) => {
    setEditingTrack(track);
    setTrackForm({
      name: track.name,
      description: track.description || '',
    });
    setShowTrackModal(true);
  };

  const handleSaveTrack = async () => {
    if (!trackForm.name.trim()) {
      toast.error('Track name is required');
      return;
    }

    try {
      if (editingTrack) {
        await AgendaService.updateTrack(editingTrack.id, {
          name: trackForm.name,
          description: trackForm.description || undefined,
        });
        toast.success('Track updated successfully');
      } else {
        const newTrack = await AgendaService.createTrack({
          event_uuid: eventUuid,
          name: trackForm.name,
          description: trackForm.description || undefined,
          sort_order: tracks.length,
        });
        setSelectedTrackId(newTrack.id);
        toast.success('Track created successfully');
      }
      setShowTrackModal(false);
      loadData();
    } catch (error) {
      console.error('Error saving track:', error);
      toast.error('Failed to save track');
    }
  };

  const handleDeleteTrack = async () => {
    if (!deletingTrack) return;

    try {
      await AgendaService.deleteTrack(deletingTrack.id);
      toast.success('Track deleted successfully');
      setDeletingTrack(null);

      // Select another track if the deleted one was selected
      if (selectedTrackId === deletingTrack.id) {
        const remainingTracks = tracks.filter(t => t.id !== deletingTrack.id);
        setSelectedTrackId(remainingTracks[0]?.id || '');
      }

      loadData();
    } catch (error) {
      console.error('Error deleting track:', error);
      toast.error('Failed to delete track');
    }
  };

  // ====== ENTRY HANDLERS ======

  const handleAddEntry = (entryType: AgendaEntryType = 'session') => {
    setEditingEntry(null);
    const defaultStartTime = getNextAvailableStartTime();
    const defaultEndTime = getEndTimeFromStart(defaultStartTime);
    setEntryForm({
      track_id: selectedTrackId || tracks[0]?.id || '',
      start_time: defaultStartTime,
      end_time: defaultEndTime,
      title: entryType === 'break' ? 'Break' : entryType === 'spacer' ? '' : '',
      description: '',
      location: '',
      speaker_ids: [],
      entry_type: entryType,
      talk_id: '',
    });
    setShowEntryModal(true);
  };

  const handleEditEntry = async (entry: AgendaEntry) => {
    setEditingEntry(entry);

    // Get current speakers for this entry
    const currentSpeakers = entrySpeakers[entry.id] || [];

    setEntryForm({
      track_id: entry.track_id,
      start_time: entry.start_time.slice(0, 16), // Format for datetime-local input
      end_time: entry.end_time.slice(0, 16),
      title: entry.title,
      description: entry.description || '',
      location: entry.location || '',
      speaker_ids: currentSpeakers.map(s => s.id),
      entry_type: entry.entry_type || 'session',
      talk_id: entry.talk_id || '',
    });
    setShowEntryModal(true);
  };

  const handleSaveEntry = async () => {
    // Spacers don't require a title
    if (entryForm.entry_type !== 'spacer' && !entryForm.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!entryForm.start_time) {
      toast.error('Start time is required');
      return;
    }
    if (!entryForm.end_time) {
      toast.error('End time is required');
      return;
    }
    if (new Date(entryForm.end_time) <= new Date(entryForm.start_time)) {
      toast.error('End time must be after start time');
      return;
    }

    try {
      let entryId: string;

      if (editingEntry) {
        await AgendaService.updateEntry(editingEntry.id, {
          track_id: entryForm.track_id,
          start_time: entryForm.start_time,
          end_time: entryForm.end_time,
          title: entryForm.title,
          description: entryForm.description || undefined,
          location: entryForm.location || undefined,
          entry_type: entryForm.entry_type,
          talk_id: entryForm.talk_id || undefined,
        });
        entryId = editingEntry.id;
        toast.success('Entry updated successfully');
      } else {
        const newEntry = await AgendaService.createEntry({
          event_uuid: eventUuid,
          track_id: entryForm.track_id,
          start_time: entryForm.start_time,
          end_time: entryForm.end_time,
          title: entryForm.title,
          description: entryForm.description || undefined,
          location: entryForm.location || undefined,
          entry_type: entryForm.entry_type,
          talk_id: entryForm.talk_id || undefined,
        });
        entryId = newEntry.id;
        toast.success('Entry created successfully');
      }

      // Update speakers for this entry
      await SpeakerService.updateAgendaEntrySpeakers(entryId, entryForm.speaker_ids);

      setShowEntryModal(false);
      loadData();
    } catch (error) {
      console.error('Error saving entry:', error);
      toast.error('Failed to save entry');
    }
  };

  const handleDeleteEntry = async () => {
    if (!deletingEntry) return;

    try {
      await AgendaService.deleteEntry(deletingEntry.id);
      toast.success('Entry deleted successfully');
      setDeletingEntry(null);
      loadData();
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast.error('Failed to delete entry');
    }
  };

  const getEntriesForTrack = (trackId: string) => {
    return entries.filter(e => e.track_id === trackId).sort((a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Calculate the next available start time based on existing entries or event start
  const getNextAvailableStartTime = (): string => {
    // Get all entries sorted by end time
    const sortedEntries = [...entries].sort((a, b) =>
      new Date(b.end_time).getTime() - new Date(a.end_time).getTime()
    );

    if (sortedEntries.length > 0) {
      // Use the latest end time from existing entries
      const latestEndTime = new Date(sortedEntries[0].end_time);
      // Format for datetime-local input (YYYY-MM-DDTHH:mm)
      return latestEndTime.toISOString().slice(0, 16);
    }

    // No entries exist - use event start time if available
    if (eventStart) {
      const startDate = new Date(eventStart);
      return startDate.toISOString().slice(0, 16);
    }

    // Fallback: use current date at 9am
    const now = new Date();
    now.setHours(9, 0, 0, 0);
    return now.toISOString().slice(0, 16);
  };

  // Calculate end time as start time + 30 minutes
  const getEndTimeFromStart = (startTime: string): string => {
    if (!startTime) return '';
    const start = new Date(startTime);
    start.setMinutes(start.getMinutes() + 30);
    return start.toISOString().slice(0, 16);
  };

  // Handle talk selection - auto-fill entry form from talk data
  const handleTalkSelect = (talkId: string) => {
    if (!talkId) {
      setEntryForm({ ...entryForm, talk_id: '' });
      return;
    }
    const talk = talks.find(t => t.id === talkId);
    if (!talk) return;

    // Calculate end time from talk duration
    let newEndTime = entryForm.end_time;
    if (talk.duration_minutes && entryForm.start_time) {
      const start = new Date(entryForm.start_time);
      start.setMinutes(start.getMinutes() + talk.duration_minutes);
      newEndTime = start.toISOString().slice(0, 16);
    }

    // Auto-fill from talk, get speaker IDs from talk speakers
    const talkSpeakerIds = talk.speakers.map(s => s.speaker_id);

    setEntryForm({
      ...entryForm,
      talk_id: talkId,
      title: talk.title,
      description: talk.synopsis || '',
      end_time: newEndTime,
      speaker_ids: talkSpeakerIds,
    });
  };

  // Get entry type styling
  const getEntryTypeClasses = (entryType: AgendaEntryType) => {
    switch (entryType) {
      case 'session':
        return 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700';
      case 'break':
        return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700';
      case 'spacer':
        return 'bg-gray-100 dark:bg-gray-800 border-dashed border-gray-300 dark:border-gray-600';
      default:
        return 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700';
    }
  };

  // ====== DRAG AND DROP HANDLERS ======

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) {
      setOverTrackId(null);
      return;
    }

    // Check if we're over a track column (for timeline view)
    const overId = over.id as string;
    if (overId.startsWith('track-')) {
      const trackId = overId.replace('track-', '');
      setOverTrackId(trackId);
      return;
    }

    // Otherwise we're over an entry (for list view)
    const overEntry = entries.find(e => e.id === over.id);
    if (overEntry) {
      setOverTrackId(overEntry.track_id);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverTrackId(null);

    if (!over || active.id === over.id) return;

    const activeEntry = entries.find(e => e.id === active.id);
    if (!activeEntry) return;

    // Check if we dropped on a track column (timeline view)
    const overId = over.id as string;
    const isTrackDrop = overId.startsWith('track-');

    let targetTrackId: string;
    let insertIndex: number;
    let targetTrackEntries: AgendaEntry[];

    if (isTrackDrop) {
      // Dropped on a track column - move to end of that track
      targetTrackId = overId.replace('track-', '');
      targetTrackEntries = getEntriesForTrack(targetTrackId);
      insertIndex = targetTrackEntries.length; // Add to end
    } else {
      // Dropped on another entry (list view behavior)
      const overEntry = entries.find(e => e.id === over.id);
      if (!overEntry) return;

      targetTrackId = overEntry.track_id;
      targetTrackEntries = getEntriesForTrack(targetTrackId);
      insertIndex = targetTrackEntries.findIndex(e => e.id === over.id);
    }

    // Skip if dropped back on the same track without moving (only for list view)
    if (!isTrackDrop && activeEntry.track_id === targetTrackId) {
      const oldIndex = targetTrackEntries.findIndex(e => e.id === active.id);
      if (oldIndex === insertIndex) return;
    }

    setIsReordering(true);

    try {
      const isMovingBetweenTracks = activeEntry.track_id !== targetTrackId;

      if (isMovingBetweenTracks) {
        // Moving to a different track
        await recalculateTimesAfterMove(
          activeEntry,
          targetTrackId,
          insertIndex,
          targetTrackEntries
        );
        toast.success(`Moved to ${tracks.find(t => t.id === targetTrackId)?.name || 'track'}`);
      } else if (!isTrackDrop) {
        // Same track reorder (only for list view)
        const oldIndex = targetTrackEntries.findIndex(e => e.id === active.id);
        if (oldIndex !== -1 && insertIndex !== -1 && oldIndex !== insertIndex) {
          await recalculateTimesAfterReorder(targetTrackEntries, oldIndex, insertIndex);
          toast.success('Agenda updated');
        }
      }

      await loadData();
    } catch (error) {
      console.error('Error reordering entries:', error);
      toast.error('Failed to update agenda order');
    } finally {
      setIsReordering(false);
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverTrackId(null);
  };

  // Recalculate times when entries are reordered within the same track
  const recalculateTimesAfterReorder = async (
    trackEntries: AgendaEntry[],
    oldIndex: number,
    newIndex: number
  ) => {
    // Create new array with reordered entries
    const reorderedEntries = [...trackEntries];
    const [movedEntry] = reorderedEntries.splice(oldIndex, 1);
    reorderedEntries.splice(newIndex, 0, movedEntry);

    // Get the first entry's start time as the base
    const firstStartTime = new Date(reorderedEntries[0].start_time);

    // Calculate new times for all entries
    let currentStartTime = firstStartTime;

    const updates: Promise<void>[] = [];

    for (const entry of reorderedEntries) {
      const duration = new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime();
      const newStartTime = new Date(currentStartTime);
      const newEndTime = new Date(currentStartTime.getTime() + duration);

      // Only update if times changed
      if (
        newStartTime.toISOString() !== entry.start_time ||
        newEndTime.toISOString() !== entry.end_time
      ) {
        updates.push(
          AgendaService.updateEntry(entry.id, {
            start_time: newStartTime.toISOString().slice(0, 16),
            end_time: newEndTime.toISOString().slice(0, 16),
          })
        );
      }

      // Next entry starts when this one ends
      currentStartTime = newEndTime;
    }

    await Promise.all(updates);
  };

  // Move an entry to a different track without changing times
  // This allows parallel sessions at the same time on different tracks
  const recalculateTimesAfterMove = async (
    movedEntry: AgendaEntry,
    targetTrackId: string,
    _insertIndex: number,
    _targetTrackEntries: AgendaEntry[]
  ) => {
    // Just update the track - keep the original time slot
    // This allows sessions to run in parallel on different tracks
    await AgendaService.updateEntry(movedEntry.id, {
      track_id: targetTrackId,
    });
  };

  // Get the active entry for DragOverlay
  const activeEntry = useMemo(() => {
    if (!activeId) return null;
    return entries.find(e => e.id === activeId) || null;
  }, [activeId, entries]);

  // Get entry IDs for the selected track (for SortableContext)
  const selectedTrackEntryIds = useMemo(() => {
    return getEntriesForTrack(selectedTrackId).map(e => e.id);
  }, [entries, selectedTrackId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="medium" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Talk Duration Options Section */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Talk Duration Options</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Configure available talk durations for speaker submissions
            </p>
          </div>
          <Button onClick={handleAddDuration} variant="outline" size="sm">
            <PlusIcon className="w-4 h-4 mr-1" />
            Add Duration
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          {durationOptions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
              No talk durations configured. Add durations to allow speakers to specify talk length.
            </p>
          ) : (
            durationOptions.map((option) => {
              const confirmedCount = confirmedDurationCounts[option.duration] || 0;
              const availableSlots = option.capacity - confirmedCount;
              return (
                <div
                  key={option.duration}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center gap-1.5">
                    <ClockIcon className="w-4 h-4 text-gray-400" />
                    <span className="font-medium text-gray-900 dark:text-white">
                      {option.duration} min
                    </span>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    availableSlots <= 0
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : availableSlots <= 2
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  }`}>
                    {confirmedCount}/{option.capacity} slots
                  </span>
                  <div className="flex gap-1 ml-1">
                    <button
                      onClick={() => handleEditDuration(option)}
                      className="p-1 text-gray-400 hover:text-primary-600 rounded"
                      title="Edit"
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRemoveDuration(option)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded"
                      title="Remove"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Talks/Sessions Section */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Sessions & Talks</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Manage talks, panels, workshops, and other sessions
            </p>
          </div>
          <Button onClick={handleAddTalk} variant="outline" size="sm">
            <PlusIcon className="w-4 h-4 mr-1" />
            Add Session
          </Button>
        </div>

        {talks.filter(t => t.status === 'confirmed' || t.status === 'approved' || t.status === 'draft').length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
            No sessions yet. Click "Add Session" to create a talk, panel, workshop, or other session.
          </p>
        ) : (
          <div className="space-y-3">
            {talks.filter(t => t.status === 'confirmed' || t.status === 'approved' || t.status === 'draft').map((talk) => {
              const sessionBadge = getSessionTypeBadge(talk.session_type);
              const statusBadge = getStatusBadge(talk.status);
              return (
                <div
                  key={talk.id}
                  className="group border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sessionBadge.bg} ${sessionBadge.text}`}>
                          {TalkService.getSessionTypeLabel(talk.session_type)}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge.bg} ${statusBadge.text}`}>
                          {talk.status}
                        </span>
                        {talk.duration_minutes && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <ClockIcon className="w-3 h-3" />
                            {talk.duration_minutes} min
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                        {talk.title}
                      </h4>
                      {talk.synopsis && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                          {talk.synopsis}
                        </p>
                      )}
                      {/* Speakers */}
                      {talk.speakers.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {talk.speakers.map((speaker) => (
                            <div
                              key={speaker.speaker_id}
                              className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded-full text-xs"
                            >
                              {speaker.avatar_url ? (
                                <img
                                  src={speaker.avatar_url}
                                  alt={speaker.full_name || 'Speaker'}
                                  className="w-4 h-4 rounded-full object-cover"
                                />
                              ) : (
                                <UserIcon className="w-4 h-4 text-gray-400" />
                              )}
                              <span className="text-gray-700 dark:text-gray-300">
                                {speaker.full_name || speaker.email}
                              </span>
                              <span className="text-gray-400 dark:text-gray-500">
                                ({TalkService.getSpeakerRoleLabel(speaker.role)})
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      {talk.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleTalkStatusChange(talk, 'approved')}
                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                            title="Approve"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleTalkStatusChange(talk, 'rejected')}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                            title="Reject"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {talk.status === 'approved' && (
                        <button
                          onClick={() => handleTalkStatusChange(talk, 'confirmed')}
                          className="p-2 text-gray-400 hover:text-green-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                          title="Confirm"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => handleEditTalk(talk)}
                        className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                        title="Edit"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeletingTalk(talk)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                        title="Delete"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Event Agenda</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage tracks/stages and their scheduled activities
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* View Toggle */}
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              Timeline
            </button>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAddTrack} variant="outline" size="sm">
              <PlusIcon className="w-4 h-4 mr-2" />
              Add Track
            </Button>
            {viewMode === 'timeline' && (
              <>
                <Button onClick={() => handleAddEntry('break')} variant="outline" size="sm">
                  <PlusIcon className="w-4 h-4 mr-1" />
                  Break
                </Button>
                <Button onClick={() => handleAddEntry('spacer')} variant="outline" size="sm">
                  <PlusIcon className="w-4 h-4 mr-1" />
                  Spacer
                </Button>
              </>
            )}
            <Button onClick={() => handleAddEntry('session')} size="sm" disabled={tracks.length === 0}>
              <PlusIcon className="w-4 h-4 mr-2" />
              Add Entry
            </Button>
          </div>
        </div>
      </div>

      {/* Timeline Toolbar (zoom controls) */}
      {viewMode === 'timeline' && tracks.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <span className="text-sm text-gray-600 dark:text-gray-400">Zoom:</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPixelsPerMinute(Math.max(1, pixelsPerMinute - 0.5))}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              title="Zoom out"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <span className="text-xs text-gray-500 w-16 text-center">{pixelsPerMinute}px/min</span>
            <button
              onClick={() => setPixelsPerMinute(Math.min(5, pixelsPerMinute + 0.5))}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              title="Zoom in"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <span className="text-xs text-gray-400">
            {timelineConfig.startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - {timelineConfig.endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      )}

      {tracks.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            No tracks/stages configured yet. Add a track to get started.
          </p>
          <Button onClick={handleAddTrack}>
            <PlusIcon className="w-4 h-4 mr-2" />
            Add Your First Track
          </Button>
        </Card>
      ) : viewMode === 'list' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Tracks Sidebar */}
            <div className="lg:col-span-1">
              <Card className="p-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                  Tracks/Stages
                </h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                  Drag entries here to move between tracks
                </p>
                <div className="space-y-2">
                  {tracks.map((track) => (
                    <DroppableTrackCard
                      key={track.id}
                      track={track}
                      isSelected={selectedTrackId === track.id}
                      isOver={overTrackId === track.id && activeId !== null}
                      entryCount={getEntriesForTrack(track.id).length}
                      onSelect={() => setSelectedTrackId(track.id)}
                      onEdit={() => handleEditTrack(track)}
                      onDelete={() => setDeletingTrack(track)}
                    />
                  ))}
                </div>
              </Card>
            </div>

            {/* Entries List */}
            <div className="lg:col-span-3">
              <Card className="p-6">
                {selectedTrackId ? (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-base font-medium text-gray-900 dark:text-white">
                        {tracks.find(t => t.id === selectedTrackId)?.name}
                      </h3>
                      {isReordering && (
                        <span className="text-xs text-primary-600 dark:text-primary-400 animate-pulse">
                          Updating times...
                        </span>
                      )}
                    </div>

                    <SortableContext
                      items={selectedTrackEntryIds}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-3">
                        {getEntriesForTrack(selectedTrackId).length === 0 ? (
                          <div className="text-center py-12">
                            <p className="text-gray-500 dark:text-gray-400 mb-4">
                              No entries for this track yet
                            </p>
                            <Button onClick={handleAddEntry} variant="outline" size="sm">
                              <PlusIcon className="w-4 h-4 mr-2" />
                              Add Entry
                            </Button>
                          </div>
                        ) : (
                          <>
                            {getEntriesForTrack(selectedTrackId).map((entry) => (
                              <SortableEntry
                                key={entry.id}
                                entry={entry}
                                speakers={entrySpeakers[entry.id] || []}
                                linkedTalk={entry.talk_id ? talksById[entry.talk_id] : undefined}
                                onEdit={handleEditEntry}
                                onDelete={setDeletingEntry}
                                onSpeakerClick={setSelectedSpeaker}
                                formatTime={formatTime}
                              />
                            ))}
                            <p className="text-xs text-gray-400 dark:text-gray-500 pt-2 text-center">
                              Drag entries to reorder • Times will adjust automatically
                            </p>
                          </>
                        )}
                      </div>
                    </SortableContext>
                  </>
                ) : (
                  <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                    Select a track to view its entries
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* Drag overlay - shows the entry being dragged */}
          <DragOverlay>
            {activeEntry && viewMode === 'list' && (
              <DragOverlayEntry
                entry={activeEntry}
                formatTime={formatTime}
              />
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        /* Timeline View */
        <Card className="p-4 overflow-hidden">
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="overflow-x-auto">
              <div
                className="relative"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `80px repeat(${tracks.length}, minmax(200px, 1fr))`,
                  minWidth: `${80 + tracks.length * 200}px`
                }}
              >
                {/* Track Headers */}
                <div className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-2 font-medium text-sm text-gray-500 dark:text-gray-400">
                  Time
                </div>
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className={`sticky top-0 z-20 border-b border-l p-2 transition-colors ${
                      overTrackId === track.id
                        ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
                        {track.name}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleEditTrack(track)}
                          className="p-1 text-gray-400 hover:text-primary-600"
                        >
                          <PencilIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Time Ruler & Track Columns */}
                <div
                  className="col-span-full"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `80px repeat(${tracks.length}, minmax(200px, 1fr))`,
                  }}
                >
                  {/* Time Ruler */}
                  <div
                    className="relative border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                    style={{ height: `${timelineHeight}px` }}
                  >
                    {timeSlots.map((slot, index) => (
                      <div
                        key={index}
                        className="absolute left-0 right-0 text-xs text-gray-500 dark:text-gray-400 pr-2 text-right"
                        style={{ top: `${slot.top}px` }}
                      >
                        <div className="flex items-center gap-1 justify-end">
                          <span>{slot.label}</span>
                          <div className="w-2 h-px bg-gray-300 dark:bg-gray-600" />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Track Columns */}
                  {tracks.map((track) => (
                    <DroppableTrackColumn
                      key={track.id}
                      track={track}
                      timelineHeight={timelineHeight}
                      timeSlots={timeSlots}
                      isOver={overTrackId === track.id}
                    >
                      {/* Entry Blocks */}
                      {entryPositionsByTrack[track.id]?.map((pos) => (
                        <DraggableTimelineEntry
                          key={pos.entry.id}
                          pos={pos}
                          entrySpeakers={entrySpeakers[pos.entry.id] || []}
                          linkedTalk={pos.entry.talk_id ? talksById[pos.entry.talk_id] : undefined}
                          onEdit={handleEditEntry}
                          onDelete={setDeletingEntry}
                          formatTime={formatTime}
                          getEntryTypeClasses={getEntryTypeClasses}
                          isDragging={activeId === pos.entry.id}
                        />
                      ))}
                    </DroppableTrackColumn>
                  ))}
                </div>
              </div>
            </div>

            {/* Drag overlay for timeline view */}
            <DragOverlay>
              {activeEntry && viewMode === 'timeline' && (
                <TimelineDragOverlay
                  entry={activeEntry}
                  height={entryPositionsByTrack[activeEntry.track_id]?.find(p => p.entry.id === activeEntry.id)?.height || 60}
                  getEntryTypeClasses={getEntryTypeClasses}
                />
              )}
            </DragOverlay>
          </DndContext>

          {/* Drag hint */}
          {entries.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 pt-3 text-center">
              Drag entries between tracks to reorganize your agenda
            </p>
          )}
        </Card>
      )}

      {/* Track Modal */}
      <Modal
        isOpen={showTrackModal}
        onClose={() => setShowTrackModal(false)}
        title={editingTrack ? 'Edit Track/Stage' : 'Add Track/Stage'}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowTrackModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTrack}>
              {editingTrack ? 'Update' : 'Create'} Track
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Track/Stage Name *
            </label>
            <Input
              value={trackForm.name}
              onChange={(e) => setTrackForm({ ...trackForm, name: e.target.value })}
              placeholder="e.g., Main Stage, Workshop Room A"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <Input
              value={trackForm.description}
              onChange={(e) => setTrackForm({ ...trackForm, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
        </div>
      </Modal>

      {/* Entry Modal */}
      <Modal
        isOpen={showEntryModal}
        onClose={() => setShowEntryModal(false)}
        title={editingEntry ? 'Edit Agenda Entry' : `Add ${entryForm.entry_type === 'break' ? 'Break' : entryForm.entry_type === 'spacer' ? 'Spacer' : 'Agenda Entry'}`}
        size="lg"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowEntryModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEntry}>
              {editingEntry ? 'Update' : 'Create'} Entry
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Entry Type
              </label>
              <select
                value={entryForm.entry_type}
                onChange={(e) => setEntryForm({ ...entryForm, entry_type: e.target.value as AgendaEntryType, talk_id: '' })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="session">Session</option>
                <option value="break">Break</option>
                <option value="spacer">Spacer</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Track/Stage *
              </label>
              <select
                value={entryForm.track_id}
                onChange={(e) => setEntryForm({ ...entryForm, track_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                {tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Link to Session/Talk (only for session type) */}
          {entryForm.entry_type === 'session' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Link to Session (Optional)
              </label>
              <select
                value={entryForm.talk_id}
                onChange={(e) => handleTalkSelect(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="">-- Select from Sessions --</option>
                {availableTalks.map((talk) => {
                  const speakerNames = talk.speakers
                    ?.filter(s => s.full_name)
                    .map(s => s.full_name)
                    .join(', ');
                  const sessionLabel = talk.session_type ? `[${talk.session_type}] ` : '';
                  const titlePart = talk.title || 'Title TBC';
                  const speakerPart = speakerNames ? ` — ${speakerNames}` : '';
                  return (
                    <option key={talk.id} value={talk.id}>
                      {sessionLabel}{titlePart} ({talk.duration_minutes || '?'} min){speakerPart}
                    </option>
                  );
                })}
                {editingEntry?.talk_id && !availableTalks.find(t => t.id === editingEntry.talk_id) && (() => {
                  const linkedTalk = talks.find(t => t.id === editingEntry.talk_id);
                  const speakerNames = linkedTalk?.speakers
                    ?.filter(s => s.full_name)
                    .map(s => s.full_name)
                    .join(', ');
                  const sessionLabel = linkedTalk?.session_type ? `[${linkedTalk.session_type}] ` : '';
                  const titlePart = linkedTalk?.title || 'Linked Session';
                  const speakerPart = speakerNames ? ` — ${speakerNames}` : '';
                  return (
                    <option value={editingEntry.talk_id}>
                      {sessionLabel}{titlePart} ({linkedTalk?.duration_minutes || '?'} min){speakerPart}
                    </option>
                  );
                })()}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Selecting a session auto-fills title, description, and duration
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title {entryForm.entry_type !== 'spacer' && '*'}
            </label>
            <Input
              value={entryForm.title}
              onChange={(e) => setEntryForm({ ...entryForm, title: e.target.value })}
              placeholder="Session title"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start Time *
              </label>
              <input
                type="datetime-local"
                value={entryForm.start_time}
                onChange={(e) => {
                  const newStartTime = e.target.value;
                  const newEndTime = getEndTimeFromStart(newStartTime);
                  setEntryForm({ ...entryForm, start_time: newStartTime, end_time: newEndTime });
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                End Time *
              </label>
              <input
                type="datetime-local"
                value={entryForm.end_time}
                onChange={(e) => setEntryForm({ ...entryForm, end_time: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Location
            </label>
            <Input
              value={entryForm.location}
              onChange={(e) => setEntryForm({ ...entryForm, location: e.target.value })}
              placeholder="Specific location (optional)"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={entryForm.description}
              onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })}
              placeholder="Optional description"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
        </div>
      </Modal>

      {/* Delete Track Confirmation */}
      <ConfirmModal
        isOpen={!!deletingTrack}
        onClose={() => setDeletingTrack(null)}
        onConfirm={handleDeleteTrack}
        title="Delete Track"
        message={`Are you sure you want to delete "${deletingTrack?.name}"? This will also delete all entries associated with this track.`}
        confirmText="Delete"
        confirmVariant="error"
      />

      {/* Delete Entry Confirmation */}
      <ConfirmModal
        isOpen={!!deletingEntry}
        onClose={() => setDeletingEntry(null)}
        onConfirm={handleDeleteEntry}
        title="Delete Entry"
        message={`Are you sure you want to delete "${deletingEntry?.title}"?`}
        confirmText="Delete"
        confirmVariant="error"
      />

      {/* Speaker Detail Modal */}
      <Modal
        isOpen={!!selectedSpeaker}
        onClose={() => setSelectedSpeaker(null)}
        title="Speaker Details"
        size="md"
        footer={
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setSelectedSpeaker(null)}>
              Close
            </Button>
          </div>
        }
      >
        {selectedSpeaker && (
          <div className="space-y-4">
            {/* Speaker Header */}
            <div className="flex items-start gap-4">
              {selectedSpeaker.avatar_url ? (
                <img
                  src={selectedSpeaker.avatar_url}
                  alt={selectedSpeaker.full_name || 'Speaker'}
                  className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <UserIcon className="w-8 h-8 text-gray-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {selectedSpeaker.full_name || selectedSpeaker.email}
                </h3>
                {(selectedSpeaker.speaker_title || selectedSpeaker.job_title) && (
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {selectedSpeaker.speaker_title || selectedSpeaker.job_title}
                  </p>
                )}
                {selectedSpeaker.company && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedSpeaker.company}
                  </p>
                )}
              </div>
            </div>

            {/* Talk Title */}
            {selectedSpeaker.talk_title && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Talk Title
                </h4>
                <p className="text-base font-medium text-gray-900 dark:text-white">
                  {selectedSpeaker.talk_title}
                </p>
              </div>
            )}

            {/* Talk Duration */}
            {selectedSpeaker.talk_duration_minutes && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Talk Duration
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {selectedSpeaker.talk_duration_minutes} minutes
                </p>
              </div>
            )}

            {/* Talk Synopsis */}
            {selectedSpeaker.talk_synopsis && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Synopsis
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                  {selectedSpeaker.talk_synopsis}
                </p>
              </div>
            )}

            {/* Speaker Bio */}
            {selectedSpeaker.speaker_bio && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Bio
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                  {selectedSpeaker.speaker_bio}
                </p>
              </div>
            )}

            {/* No talk details message */}
            {!selectedSpeaker.talk_title && !selectedSpeaker.talk_synopsis && !selectedSpeaker.speaker_bio && (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                No talk details or bio available for this speaker.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Duration Option Modal */}
      <Modal
        isOpen={showDurationModal}
        onClose={() => setShowDurationModal(false)}
        title={editingDuration ? 'Edit Talk Duration' : 'Add Talk Duration'}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowDurationModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveDuration}>
              {editingDuration ? 'Update' : 'Add'} Duration
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Duration (minutes) *
            </label>
            <Input
              type="number"
              min="1"
              value={durationForm.duration}
              onChange={(e) => setDurationForm({ ...durationForm, duration: e.target.value })}
              placeholder="e.g., 10, 25, 45"
              disabled={!!editingDuration}
            />
            {editingDuration && (
              <p className="text-xs text-gray-500 mt-1">Duration cannot be changed after creation</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Capacity (max talks) *
            </label>
            <Input
              type="number"
              min="1"
              value={durationForm.capacity}
              onChange={(e) => setDurationForm({ ...durationForm, capacity: e.target.value })}
              placeholder="e.g., 5, 10"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum number of talks with this duration
            </p>
          </div>
        </div>
      </Modal>

      {/* Talk/Session Modal */}
      <Modal
        isOpen={showTalkModal}
        onClose={() => setShowTalkModal(false)}
        title={editingTalk ? 'Edit Session' : 'Add Session'}
        size="lg"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowTalkModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTalk}>
              {editingTalk ? 'Update' : 'Create'} Session
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Session Type *
            </label>
            <select
              value={talkForm.session_type}
              onChange={(e) => setTalkForm({ ...talkForm, session_type: e.target.value as SessionType })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="talk">Talk</option>
              <option value="keynote">Keynote</option>
              <option value="panel">Panel Discussion</option>
              <option value="workshop">Workshop</option>
              <option value="lightning">Lightning Talk</option>
              <option value="fireside">Fireside Chat</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Status
            </label>
            <select
              value={talkForm.status}
              onChange={(e) => setTalkForm({ ...talkForm, status: e.target.value as TalkStatus })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending Review</option>
              <option value="reserve">Reserve</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title *
            </label>
            <Input
              value={talkForm.title}
              onChange={(e) => setTalkForm({ ...talkForm, title: e.target.value })}
              placeholder="Session title"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Synopsis
            </label>
            <textarea
              value={talkForm.synopsis}
              onChange={(e) => setTalkForm({ ...talkForm, synopsis: e.target.value })}
              placeholder="Brief description of the session"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Duration
            </label>
            <select
              value={talkForm.duration_minutes}
              onChange={(e) => setTalkForm({ ...talkForm, duration_minutes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="">No duration set</option>
              {durationOptions.map((opt) => (
                <option key={opt.duration} value={opt.duration}>
                  {opt.duration} minutes
                </option>
              ))}
            </select>
          </div>

          {/* Speaker Task Checklist - Only show for confirmed talks */}
          {editingTalk && editingTalk.status === 'confirmed' && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/50">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Speaker Task Checklist
              </h4>
              <div className="space-y-2">
                {/* Speaking slot confirmed - always checked for confirmed status */}
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <CheckIcon className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-300">Speaking slot confirmed</span>
                </div>

                {/* Calendar added */}
                <div className="flex items-center gap-2">
                  {editingTalk.calendar_added_at ? (
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                      <CheckIcon className="w-3 h-3 text-white" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 flex-shrink-0" />
                  )}
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Added to calendar
                    {editingTalk.calendar_added_at && (
                      <span className="text-xs text-gray-500 ml-2">
                        ({new Date(editingTalk.calendar_added_at).toLocaleDateString()})
                      </span>
                    )}
                  </span>
                </div>

                {/* Presentation provided */}
                <div className="flex items-center gap-2">
                  {(editingTalk.presentation_url || editingTalk.presentation_storage_path) ? (
                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                      <CheckIcon className="w-3 h-3 text-white" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 flex-shrink-0" />
                  )}
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Presentation provided
                    {editingTalk.presentation_type && (
                      <span className="text-xs text-gray-500 ml-2">
                        ({editingTalk.presentation_type === 'link' ? 'Link' : editingTalk.presentation_type === 'pdf' ? 'PDF' : 'PowerPoint'})
                      </span>
                    )}
                  </span>
                  {editingTalk.presentation_url && (
                    <a
                      href={editingTalk.presentation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 ml-1"
                    >
                      View
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Speakers Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Speakers
            </label>
            {speakers.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
                No speakers added to this event yet. Add speakers in the Speakers tab first.
              </p>
            ) : (
              <>
                {/* Selected speakers with role selection */}
                {talkForm.speakers.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {talkForm.speakers.map((talkSpeaker) => {
                      const speaker = speakers.find(s => s.id === talkSpeaker.speaker_id);
                      if (!speaker) return null;
                      return (
                        <div
                          key={talkSpeaker.speaker_id}
                          className="flex items-center gap-3 p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg"
                        >
                          {speaker.avatar_url ? (
                            <img
                              src={speaker.avatar_url}
                              alt={speaker.full_name || 'Speaker'}
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                              <UserIcon className="w-4 h-4 text-gray-400" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {speaker.full_name || speaker.email}
                            </p>
                          </div>
                          <select
                            value={talkSpeaker.role}
                            onChange={(e) => updateTalkSpeakerRole(talkSpeaker.speaker_id, e.target.value as SpeakerRole)}
                            className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          >
                            <option value="presenter">Presenter</option>
                            <option value="co_presenter">Co-Presenter</option>
                            <option value="panelist">Panelist</option>
                            <option value="moderator">Moderator</option>
                            <option value="host">Host</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => toggleTalkSpeaker(talkSpeaker.speaker_id)}
                            className="p-1 hover:bg-primary-200 dark:hover:bg-primary-800 rounded"
                          >
                            <XMarkIcon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Available speakers */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                  {speakers
                    .filter(s => !talkForm.speakers.some(ts => ts.speaker_id === s.id))
                    .map((speaker) => (
                      <button
                        key={speaker.id}
                        type="button"
                        onClick={() => toggleTalkSpeaker(speaker.id)}
                        className="w-full flex items-center gap-3 p-2.5 text-left border-b border-gray-100 dark:border-gray-800 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        {speaker.avatar_url ? (
                          <img
                            src={speaker.avatar_url}
                            alt={speaker.full_name || 'Speaker'}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                            <UserIcon className="w-4 h-4 text-gray-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {speaker.full_name || speaker.email}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {speaker.speaker_title || speaker.job_title || speaker.company || ''}
                          </p>
                        </div>
                        <PlusIcon className="w-5 h-5 text-gray-400" />
                      </button>
                    ))}
                  {speakers.filter(s => !talkForm.speakers.some(ts => ts.speaker_id === s.id)).length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 p-4 text-center">
                      All speakers have been added
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>

      {/* Delete Talk Confirmation */}
      <ConfirmModal
        isOpen={!!deletingTalk}
        onClose={() => setDeletingTalk(null)}
        onConfirm={handleDeleteTalk}
        title="Delete Session"
        message={`Are you sure you want to delete "${deletingTalk?.title}"? This cannot be undone.`}
        confirmText="Delete"
        confirmVariant="error"
      />
    </div>
  );
}
