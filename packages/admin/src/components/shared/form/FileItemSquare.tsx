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
      className={`group ring-primary-600 dark:ring-primary-500 dark:ring-offset-dark-700 relative aspect-square size-20 rounded-lg ring-offset-4 ring-offset-white transition-all hover:ring-3 ${className}`}
    >
      {isImage ? (
        <img
          className="h-full w-full object-contain"
          src={URL.createObjectURL(file)}
          alt={name}
        />
      ) : (
        <div className="bg-gray-150 dark:bg-dark-900 flex h-full w-full flex-col rounded-lg px-1 py-2 text-center select-none">
          <DocumentTextIcon className="dark:text-dark-200 m-auto size-8 text-gray-500" />
          <span className="text-tiny mt-1.5 line-clamp-2">{name}</span>
        </div>
      )}
      <div className="dark:bg-dark-700 absolute -top-4 -right-3 flex items-center justify-center rounded-full bg-white opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          onClick={handleRemove}
          className="dark:border-dark-450 size-6 shrink-0 rounded-full border p-0"
        >
          <XMarkIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
