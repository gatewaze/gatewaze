// Import Dependencies
import { XMarkIcon, DocumentTextIcon } from "@heroicons/react/24/solid";

// Local Imports
import { Button } from "@/components/ui";

// ----------------------------------------------------------------------

interface FileItemSquareProps {
  file: File;
  handleRemove: (e: any) => void;
  className?: string;
}

const isImageFile = (file: File): boolean => {
  return file.type.split("/")[0] === "image";
};

export function FileItemSquare({
  file,
  handleRemove,
  className = "",
}: FileItemSquareProps) {
  const { name } = file;
  const isImage = isImageFile(file);

  return (
    <div
      title={name}
      className={`group ring-primary-600 dark:ring-primary-500 relative aspect-square size-20 rounded-lg ring-offset-4 ring-offset-[var(--color-background)] transition-all hover:ring-3 ${className}`}
    >
      {isImage ? (
        <img
          className="h-full w-full object-contain"
          src={URL.createObjectURL(file)}
          alt={name}
        />
      ) : (
        <div className="bg-[var(--gray-a3)] flex h-full w-full flex-col rounded-lg px-1 py-2 text-center select-none">
          <DocumentTextIcon className="m-auto size-8 text-[var(--gray-11)]" />
          <span className="text-tiny mt-1.5 line-clamp-2">{name}</span>
        </div>
      )}
      <div className="absolute -top-4 -right-3 flex items-center justify-center rounded-full bg-[var(--color-background)] opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          onClick={handleRemove}
          className="size-6 shrink-0 rounded-full border border-[var(--gray-a5)] p-0"
        >
          <XMarkIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
