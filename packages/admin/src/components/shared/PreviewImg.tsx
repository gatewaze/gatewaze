// Import Dependencies
import { useEffect, useState } from "react";

// ----------------------------------------------------------------------

export interface PreviewImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  file?: File | null;
  src?: string;
  alt?: string;
}

export function PreviewImg({ file, src, alt, ...rest }: PreviewImgProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    try {
      setPreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      console.error(err);
      setPreviewUrl(null);
    }

    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  return (
    <img
      src={previewUrl || src}
      onLoad={() => {
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }
      }}
      alt={alt}
      {...rest}
    />
  );
}
