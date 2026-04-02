import { useState } from "react";
import { Text } from "@radix-ui/themes";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";

export function LogoUploadField({
  label,
  description,
  value,
  settingKey,
  onChange,
  minWidth,
  minHeight,
}: {
  label: string;
  description: string;
  value: string;
  settingKey: string;
  onChange: (v: string) => void;
  minWidth?: number;
  minHeight?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);

    if (minWidth || minHeight) {
      const valid = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const w = minWidth ?? 0;
          const h = minHeight ?? 0;
          if (img.naturalWidth < w || img.naturalHeight < h) {
            setUploadError(
              `Image must be at least ${w}×${h}px. Uploaded image is ${img.naturalWidth}×${img.naturalHeight}px.`
            );
            resolve(false);
          } else {
            resolve(true);
          }
        };
        img.onerror = () => {
          setUploadError("Could not read image dimensions.");
          resolve(false);
        };
        img.src = URL.createObjectURL(file);
      });
      if (!valid) return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const filePath = `branding/${settingKey}.${ext}`;
      const { error: err } = await supabase.storage
        .from("media")
        .upload(filePath, file, { upsert: true });
      if (err) throw err;
      const {
        data: { publicUrl },
      } = supabase.storage.from("media").getPublicUrl(filePath);
      onChange(publicUrl);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Text as="label" size="2" weight="medium">
        {label}
      </Text>
      <Text as="p" size="1" color="gray">
        {description}
      </Text>
      <div className="flex items-center gap-3">
        {value && (
          <div className="flex h-12 w-24 items-center justify-center rounded border border-[var(--gray-6)] bg-[var(--gray-2)] p-1">
            <img
              src={value}
              alt={label}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}
        <Button variant="outline" size="2" disabled={uploading} asChild>
          <label className="cursor-pointer">
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {uploading ? "Uploading..." : "Upload"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
            />
          </label>
        </Button>
        {value && (
          <Button variant="ghost" size="2" onClick={() => onChange("")}>
            Remove
          </Button>
        )}
      </div>
      {uploadError && (
        <Text as="p" size="1" color="red">
          {uploadError}
        </Text>
      )}
      {value && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-xs"
        />
      )}
    </div>
  );
}
