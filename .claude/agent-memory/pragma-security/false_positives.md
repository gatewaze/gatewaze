---
name: False positives
description: Strings and patterns that look dangerous but are confirmed safe in this project
type: project
---

- `resolveSharedImports` regex `[\w.-]+\.ts` — looks like it could allow dot-traversal filenames, but path.join does NOT treat `....ts` as a traversal sequence; only `..` alone triggers parent resolution
- `serviceRoleKey` passed to Supabase client — this is the expected usage pattern for server-side service role auth; not a leak
- `verify_jwt: false` in cloud-api.ts deploy metadata — intentional; module functions rely on Supabase RLS not JWT at the edge layer
