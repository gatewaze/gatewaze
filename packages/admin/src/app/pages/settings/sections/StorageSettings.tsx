"use client";

import { useState } from "react";
import { Button, Text, Heading, Callout } from "@radix-ui/themes";
import { Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Storage settings sub-panel.
 *
 * Controls the `storage_bucket_url` platform setting — the base URL used to resolve
 * relative storage paths into public URLs at read time. See
 * `specs/spec-relative-storage-paths.md` for the full design.
 *
 * Validation is intentionally strict:
 * - HTTPS required (TLS).
 * - No trailing slash, no query params, no fragment.
 * - Hostname must be in the server-side `ALLOWED_STORAGE_DOMAINS` env var (enforced
 *   at save time via the API; enforced again at runtime in the portal brand config).
 */

const CLIENT_URL_PATTERN = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^/?#\s]+)*$/i;

/**
 * Validate a `storage_bucket_url` value against the server-side allow-list.
 * Returns null on success, or an error message on failure. Empty strings are
 * accepted (they trigger the runtime fallback to `${SUPABASE_URL}/storage/v1/object/public/media`).
 *
 * If the server-side edge function isn't deployed (404), falls back to client-side
 * URL shape validation only. The portal's runtime allow-list check (in BrandConfig
 * resolution) is the authoritative security gate — this admin check is the first
 * of two defense-in-depth layers.
 */
export async function validateStorageBucketUrl(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (trimmed === "") return null;

  // Client-side shape check first — cheap, catches typos before the network call.
  if (!CLIENT_URL_PATTERN.test(trimmed)) {
    return "URL must be HTTPS with no trailing slash, query string, or fragment.";
  }
  if (trimmed.endsWith("/")) {
    return "Remove the trailing slash.";
  }

  // Server-side allow-list check (defense-in-depth).
  try {
    const { data, error } = await supabase.functions.invoke(
      "settings-storage-bucket-url?op=validate",
      { body: { url: trimmed } },
    );
    if (error) {
      // If the function isn't deployed yet, accept the save but warn — the portal's
      // runtime check will reject if the hostname is outside ALLOWED_STORAGE_DOMAINS.
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("404") || msg.includes("not found") || msg.includes("failed to fetch")) {
        console.warn(
          "[storage] Server-side validation endpoint unavailable; relying on runtime allow-list",
        );
        return null;
      }
      return error.message ?? "Validation failed";
    }
    const body = data as { ok: boolean; error?: string };
    if (!body.ok) return body.error ?? "Validation failed";
    return null;
  } catch (err) {
    // Same graceful fallback for network-level failures.
    console.warn("[storage] Server-side validation failed, relying on runtime allow-list:", err);
    return null;
  }
}

export interface StorageSettingsProps {
  value: string;
  onChange: (next: string) => void;
  /** Feature flag set at build time when infra egress controls are verified. */
  ssrfEgressControlled?: boolean;
}

const URL_PATTERN = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^/?#\s]+)*$/i;

export function StorageSettings({ value, onChange, ssrfEgressControlled }: StorageSettingsProps) {
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<
    { ok: true; status: number } | { ok: false; error: string } | null
  >(null);

  const trimmed = value.trim();
  const isEmpty = trimmed === "";
  const isValidShape = isEmpty || URL_PATTERN.test(trimmed);
  const hasTrailingSlash = trimmed.endsWith("/");

  async function runProbe() {
    if (!isValidShape || isEmpty) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "settings-storage-bucket-url?op=probe",
        { body: { url: trimmed } },
      );
      if (error) {
        const msg = (error.message ?? "").toLowerCase();
        if (msg.includes("404") || msg.includes("not found") || msg.includes("failed to fetch")) {
          setProbeResult({
            ok: false,
            error: "Probe function not deployed. Deploy settings-storage-bucket-url to enable this check.",
          });
          return;
        }
        setProbeResult({ ok: false, error: error.message ?? "Probe failed" });
        return;
      }
      const body = data as { ok: boolean; status?: number; error?: string };
      if (body.ok) {
        setProbeResult({ ok: true, status: body.status ?? 200 });
      } else {
        setProbeResult({ ok: false, error: body.error ?? "Probe failed" });
      }
    } catch (err) {
      setProbeResult({
        ok: false,
        error: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setProbing(false);
    }
  }

  function resetToDefault() {
    onChange("");
    setProbeResult(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <Heading size="3" className="pb-1">
          Storage Base URL
        </Heading>
        <Text as="p" size="1" color="gray" className="pb-3">
          The base URL used to resolve stored relative paths (e.g. <code>people/42.png</code>)
          into full image URLs. Leave empty to use the default Supabase storage URL. Editing
          this enables migrating images to a CDN or alternative storage provider without
          changing any stored data.
        </Text>
      </div>

      <div>
        <label className="block pb-2">
          <Text as="span" size="2" weight="medium">
            URL
          </Text>
        </label>
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setProbeResult(null);
          }}
          placeholder="https://project.supabase.co/storage/v1/object/public/media"
          spellCheck={false}
          className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
        />
        {!isEmpty && !isValidShape && (
          <Text as="p" size="1" color="red" className="pt-1">
            Must be HTTPS with no trailing slash, query string, or fragment.
          </Text>
        )}
        {!isEmpty && isValidShape && hasTrailingSlash && (
          <Text as="p" size="1" color="red" className="pt-1">
            Remove the trailing slash.
          </Text>
        )}
      </div>

      <div className="flex items-center gap-3">
        {ssrfEgressControlled ? (
          <Button
            variant="soft"
            onClick={runProbe}
            disabled={probing || isEmpty || !isValidShape}
          >
            {probing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Testing…
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" /> Test URL
              </>
            )}
          </Button>
        ) : (
          <Text size="1" color="gray">
            Test button disabled — server-side SSRF egress controls not verified in this
            environment.
          </Text>
        )}
        {!isEmpty && (
          <Button variant="ghost" onClick={resetToDefault}>
            Reset to default
          </Button>
        )}
      </div>

      {probeResult?.ok && (
        <Callout.Root color="green" size="1">
          <Callout.Icon>
            <CheckCircle2 className="h-4 w-4" />
          </Callout.Icon>
          <Callout.Text>
            Reachable (HTTP {probeResult.status}).
          </Callout.Text>
        </Callout.Root>
      )}
      {probeResult && !probeResult.ok && (
        <Callout.Root color="red" size="1">
          <Callout.Icon>
            <XCircle className="h-4 w-4" />
          </Callout.Icon>
          <Callout.Text>Probe failed: {probeResult.error}</Callout.Text>
        </Callout.Root>
      )}

      <Callout.Root color="gray" size="1">
        <Callout.Text>
          <strong>Security:</strong> the hostname must be listed in the server's{" "}
          <code>ALLOWED_STORAGE_DOMAINS</code> environment variable. Saving a URL with a
          non-allowed hostname will fail, and the runtime config silently falls back to
          the default if the allow-list is tightened after a value is saved.
        </Callout.Text>
      </Callout.Root>
    </div>
  );
}
