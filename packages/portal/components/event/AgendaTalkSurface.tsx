'use client'

/**
 * The expanded state of an agenda entry whose talk has a recap behind it —
 * spec-event-agenda-schedule-import.md §10.1.
 *
 * Recording, the recap's "worth noting" line, and a strip from the matched
 * photo album. Read live through conference_recap_videos.agenda_entry_id, so
 * a re-run of the recap shows up here immediately and a deleted recap leaves
 * nothing behind. The recap resource remains the editorial artefact; this is
 * the reference view.
 *
 * Purely presentational: the parent has already decided there is something
 * to show. Values originate from imported programme data and third-party
 * playlist metadata, so the YouTube id and every storage path have been
 * validated server-side and the URL builders re-validate before emitting a
 * URL (see lib/agendaTalkSurface.ts).
 */

import Image from 'next/image'
import { VideoPlayer } from '@/components/video/VideoPlayer'
import { talkPhotoUrl, type AgendaTalkMedia } from '@/lib/agendaTalkSurface'

interface Props {
  media: AgendaTalkMedia
  /** Storage bucket the photo paths live in, as the API reported it. */
  bucket: string
  /** The brand's browser-visible Supabase URL. */
  supabaseUrl: string
  /** Fallback label for the player when the recording carries no title. */
  fallbackTitle: string
  useDarkText: boolean
}

export function AgendaTalkSurface({ media, bucket, supabaseUrl, fallbackTitle, useDarkText }: Props) {
  const photos = media.photos
    .map((photo) => ({ ...photo, url: talkPhotoUrl(supabaseUrl, bucket, photo.storage_path) }))
    .filter((photo): photo is typeof photo & { url: string } => photo.url !== null)

  const textMuted = useDarkText ? 'text-gray-600' : 'text-white/70'
  const divider = useDarkText ? 'border-gray-900/10' : 'border-white/10'

  return (
    <div className={`mt-3 pt-3 border-t ${divider} space-y-3`}>
      {media.youtube_id && (
        <div className="rounded-lg overflow-hidden max-w-2xl">
          <VideoPlayer youtubeId={media.youtube_id} title={media.video_title || fallbackTitle} />
        </div>
      )}

      {media.worth_noting && (
        <div className="flex gap-2">
          <svg
            className={`w-4 h-4 mt-0.5 flex-shrink-0 ${textMuted}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <p className={`text-sm italic ${textMuted}`}>{media.worth_noting}</p>
        </div>
      )}

      {photos.length > 0 && (
        <div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((photo) => (
              <div
                key={photo.storage_path}
                className="relative flex-shrink-0 w-28 h-20 rounded-md overflow-hidden bg-black/20"
              >
                {/* `unoptimized` matches PhotoGrid: the resize already
                    happened at the CDN, and the pull-zone host is not in
                    next.config's remotePatterns. */}
                <Image
                  src={photo.url}
                  alt={photo.alt}
                  fill
                  sizes="112px"
                  className="object-cover"
                  unoptimized
                />
              </div>
            ))}
          </div>
          {media.album && (
            <p className={`text-xs mt-1 ${textMuted}`}>{media.album}</p>
          )}
        </div>
      )}
    </div>
  )
}
