// Import Dependencies
import { TrashIcon } from "@heroicons/react/24/outline";
import {
  DocumentTextIcon,
  FilmIcon,
  MusicalNoteIcon,
  PhotoIcon,
} from "@heroicons/react/24/solid";
import { ComponentType } from "react";

// Local Imports
import { Button } from "@/components/ui";
import { formatBytes } from "@/utils/formatByte";

// ----------------------------------------------------------------------

export type MediaType = "image" | "video" | "audio" | "document";

interface FileItemProps {
  file: File;
  handleRemove: () => void;
  className?: string;
}

interface MediaIconProps {
  className: string;
}

type MediaIconMap = Record<MediaType, ComponentType<MediaIconProps>>;

const MEDIA_ICONS: MediaIconMap = {
  image: PhotoIcon,
  video: FilmIcon,
  audio: MusicalNoteIcon,
  document: DocumentTextIcon,
};

const MEDIA_TYPE_MAP: Record<string, MediaType> = {
  'image/': 'image',
  'video/': 'video',
  'audio/': 'audio',
};

const getMediaType = (file: File): MediaType => {
  const fileType = file.type.split('/')[0];
  return MEDIA_TYPE_MAP[`${fileType}/`] || 'document';
};

export function FileItem({ file, handleRemove, className = '' }: FileItemProps) {
  const { name, size } = file;
  const mediaType = getMediaType(file);
  const Icon = MEDIA_ICONS[mediaType];

  return (
    <div
      className={`flex w-full items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-dark-450 md:p-4 ${className}`}
    >
      <div className="mr-2 flex min-w-0 items-center space-x-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-dark-900 dark:text-dark-300">
          <Icon className="size-6" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-gray-800 dark:text-dark-100">{name}</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-dark-300">
            {formatBytes(size)}
          </p>
        </div>
      </div>
      <Button
        onClick={handleRemove}
        variant="flat"
        className="-mr-1 size-7 shrink-0 p-0"
      >
        <TrashIcon className="size-4.5" />
      </Button>
    </div>
  );
}
