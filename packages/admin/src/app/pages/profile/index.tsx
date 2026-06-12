import { useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/shared/Page";
import { WorkspaceLayout } from "@/components/ui";
import { ImageUpload } from "@/components/ui/ImageUpload";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui";
import { useAuthContext } from "@/app/contexts/auth/context";
import { getSupabase } from "@/lib/supabase";

function initials(name?: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("");
}

export default function ProfilePage() {
  const { user } = useAuthContext();
  const [name, setName] = useState(user?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);

  const dirty = name.trim() !== (user?.name ?? "") || (avatarUrl ?? "") !== (user?.avatarUrl ?? "");

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name can't be empty");
      return;
    }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { data: auth } = await supabase.auth.getUser();
      const authId = auth.user?.id;
      if (!authId) throw new Error("Not signed in");

      const { error } = await supabase
        .from("admin_profiles")
        .update({ name: name.trim(), avatar_url: avatarUrl })
        .eq("user_id", authId);
      if (error) throw error;

      toast.success("Profile saved. Reload to see it across the app.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title="Profile">
      <WorkspaceLayout
        title="Profile"
        actions={
          <Button onClick={handleSave} disabled={!dirty || saving} variant="solid">
            {saving ? "Saving…" : "Save"}
          </Button>
        }
      >
        <div className="max-w-xl space-y-6">
          <div className="flex items-center gap-4">
            <Avatar size={16} src={avatarUrl ?? undefined} name={name}>
              {initials(name)}
            </Avatar>
            <div>
              <p className="text-sm font-medium text-[var(--gray-12)]">{name || "Your name"}</p>
              {user?.email && <p className="text-xs text-[var(--gray-11)]">{user.email}</p>}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--gray-12)]">
              Display name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-[var(--gray-a6)] bg-[var(--color-panel-solid)] px-3 py-2 text-sm text-[var(--gray-12)]"
              placeholder="Your name"
            />
          </div>

          <ImageUpload
            label="Profile image"
            value={avatarUrl ?? undefined}
            onChange={(url) => setAvatarUrl(url)}
            accept="image/*"
            maxSizeInMB={10}
          />
        </div>
      </WorkspaceLayout>
    </Page>
  );
}
