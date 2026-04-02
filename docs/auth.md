# Authentication

Gatewaze uses an adapter pattern for authentication, supporting both Supabase Auth and external OIDC providers. This guide covers setting up each provider, the permissions system, and integrating external auth with Supabase's Row Level Security.

---

## Table of Contents

- [Overview](#overview)
- [Supabase Auth (Default)](#supabase-auth-default)
- [OIDC (External Identity Provider)](#oidc-external-identity-provider)
- [Permissions System](#permissions-system)
- [RLS and External Auth Integration](#rls-and-external-auth-integration)

---

## Overview

Gatewaze separates authentication (who you are) from authorization (what you can do). The auth adapter handles authentication, while the permissions system handles authorization.

```
User
  |
  v
Auth Adapter (Supabase Auth or OIDC)
  |
  |  authenticates, returns user identity
  v
Admin Profile Lookup (admin_profiles table)
  |
  |  maps identity to admin role + permissions
  v
Permission Check
  |
  |  role + feature permissions = access decision
  v
Authorized Action
```

The `AUTH_PROVIDER` environment variable (or `auth.provider` in `gatewaze.config.ts`) controls which adapter is active. Changing the provider does not affect existing data -- admin profiles and permissions are stored independently of the auth provider.

---

## Supabase Auth (Default)

Supabase Auth is the default authentication provider. It handles user accounts, session management, and email delivery for authentication flows.

### How It Works

The default flow uses magic links (passwordless email login):

1. User enters their email address on the admin login page.
2. Supabase Auth sends a magic link to that email address.
3. User clicks the link, which contains a one-time token.
4. The token is exchanged for a session JWT.
5. The JWT is used for all subsequent API requests.
6. The admin app looks up the user's `admin_profiles` record by their Supabase `user_id` to determine their role and permissions.

### Setting Up Email for Magic Links

Magic links require a working email delivery mechanism. In development, Supabase captures emails in its built-in Inbucket mail server (accessible at http://localhost:54324). For production, configure one of the following:

#### Option A: Supabase SMTP settings

Set SMTP variables in your `.env` file. These are used by the Supabase GoTrue service directly:

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.your-sendgrid-key
SMTP_ADMIN_EMAIL=noreply@yourdomain.com
```

#### Option B: Supabase Cloud email

If you are using Supabase Cloud, configure email in your project's dashboard under **Authentication > Email Templates**. Supabase Cloud provides a built-in email service for low-volume sends and supports custom SMTP for higher volumes.

### Adding Password-Based Auth

To enable password-based login alongside magic links:

1. **Enable email sign-up** in your Supabase configuration:

   ```bash
   ENABLE_EMAIL_SIGNUP=true
   ```

2. **Optionally enable auto-confirm** to skip email verification (not recommended for production):

   ```bash
   ENABLE_EMAIL_AUTOCONFIRM=false
   ```

3. **Update the admin login page** to include a password field. The Supabase client library supports both flows:

   ```typescript
   // Magic link
   const { error } = await supabase.auth.signInWithOtp({
     email: 'user@example.com',
   });

   // Password
   const { error } = await supabase.auth.signInWithPassword({
     email: 'user@example.com',
     password: 'secure-password',
   });
   ```

4. **Create user accounts** with passwords via the Supabase dashboard, Supabase Studio, or programmatically using the admin API:

   ```typescript
   const { data, error } = await supabaseAdmin.auth.admin.createUser({
     email: 'user@example.com',
     password: 'secure-password',
     email_confirm: true,
   });
   ```

### User Management (admin_profiles)

Admin users are tracked in the `admin_profiles` table:

```sql
CREATE TABLE public.admin_profiles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email      text UNIQUE NOT NULL,
  name       text,
  role       text NOT NULL DEFAULT 'editor'
               CHECK (role IN ('super_admin', 'admin', 'editor')),
  avatar_url text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

The `user_id` column links the admin profile to the Supabase Auth user. When a user signs in, the application looks up their profile by `user_id` to determine their role.

#### Creating admin users

1. **Via the admin UI:** Navigate to the user management section as a super_admin.
2. **Via Supabase Studio:** Insert a row into `admin_profiles` with the user's email. Set `user_id` after they sign in for the first time.
3. **Via SQL:**

   ```sql
   INSERT INTO admin_profiles (email, name, role)
   VALUES ('newadmin@example.com', 'New Admin', 'admin');
   ```

#### Disabling access

Set `is_active = false` to revoke access without deleting the profile:

```sql
UPDATE admin_profiles SET is_active = false WHERE email = 'user@example.com';
```

---

## OIDC (External Identity Provider)

For organizations that manage identity centrally, Gatewaze supports any OpenID Connect (OIDC) provider.

### Setting Up with Keycloak

[Keycloak](https://www.keycloak.org/) is a popular open-source identity provider.

#### 1. Create a realm

Create a new realm (e.g., `gatewaze`) or use an existing one.

#### 2. Create a client

In your Keycloak realm, create a new client:

| Setting                 | Value                                                  |
|-------------------------|--------------------------------------------------------|
| Client ID               | `gatewaze-admin`                                       |
| Client Protocol         | `openid-connect`                                       |
| Access Type              | `confidential`                                         |
| Valid Redirect URIs      | `http://localhost:5173/auth/callback` (dev) or your production URL |
| Web Origins              | `http://localhost:5173` or your production URL         |

#### 3. Note the client secret

Go to the **Credentials** tab and copy the client secret.

#### 4. Create roles

Create the following realm roles (or client roles):

- `gatewaze-super-admin`
- `gatewaze-admin`
- `gatewaze-editor`

Assign these roles to your users.

#### 5. Configure Gatewaze

Update your `.env`:

```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://keycloak.yourdomain.com/realms/gatewaze
OIDC_CLIENT_ID=gatewaze-admin
OIDC_CLIENT_SECRET=your-client-secret
```

Update `gatewaze.config.ts`:

```typescript
auth: {
  provider: 'oidc',
  oidc: {
    issuerUrl: process.env.OIDC_ISSUER_URL,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    scopes: ['openid', 'profile', 'email'],
    roleMapping: {
      claimPath: 'realm_access.roles',
      superAdmin: 'gatewaze-super-admin',
      admin: 'gatewaze-admin',
      editor: 'gatewaze-editor',
    },
  },
},
```

### Setting Up with Auth0

[Auth0](https://auth0.com/) is a popular managed identity platform.

#### 1. Create an application

In the Auth0 dashboard, create a new **Regular Web Application**.

| Setting                 | Value                                                    |
|-------------------------|----------------------------------------------------------|
| Name                    | `Gatewaze Admin`                                         |
| Allowed Callback URLs   | `http://localhost:5173/auth/callback`                    |
| Allowed Logout URLs      | `http://localhost:5173`                                  |
| Allowed Web Origins      | `http://localhost:5173`                                  |

#### 2. Note credentials

Copy the **Domain**, **Client ID**, and **Client Secret** from the application settings.

#### 3. Set up roles

Navigate to **User Management > Roles** and create:

- `gatewaze-super-admin`
- `gatewaze-admin`
- `gatewaze-editor`

#### 4. Add roles to the ID token

Create a post-login Action or Rule that adds roles to the token:

```javascript
// Auth0 Action: Add roles to token
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://gatewaze.io';
  const roles = event.authorization?.roles || [];
  api.idToken.setCustomClaim(`${namespace}/roles`, roles);
  api.accessToken.setCustomClaim(`${namespace}/roles`, roles);
};
```

#### 5. Configure Gatewaze

```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://your-tenant.auth0.com/
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
```

```typescript
auth: {
  provider: 'oidc',
  oidc: {
    issuerUrl: process.env.OIDC_ISSUER_URL,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    scopes: ['openid', 'profile', 'email'],
    roleMapping: {
      claimPath: 'https://gatewaze.io/roles',
      superAdmin: 'gatewaze-super-admin',
      admin: 'gatewaze-admin',
      editor: 'gatewaze-editor',
    },
  },
},
```

### Setting Up with Google Workspace

For organizations using Google Workspace, you can use Google as an OIDC provider.

#### 1. Create OAuth credentials

In the [Google Cloud Console](https://console.cloud.google.com/):

1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials > OAuth client ID**.
3. Select **Web application**.
4. Set the authorized redirect URI to `http://localhost:5173/auth/callback` (or your production URL).
5. Note the Client ID and Client Secret.

#### 2. Configure Gatewaze

```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER_URL=https://accounts.google.com
OIDC_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
OIDC_CLIENT_SECRET=your-google-client-secret
```

```typescript
auth: {
  provider: 'oidc',
  oidc: {
    issuerUrl: process.env.OIDC_ISSUER_URL,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    scopes: ['openid', 'profile', 'email'],
  },
},
```

Google does not provide custom roles in tokens by default. When using Google as the OIDC provider, admin roles are managed entirely through the `admin_profiles` table. Users are matched by email address after authentication.

### OIDC Configuration Reference

| Config Path                       | Type       | Required | Description                                      |
|-----------------------------------|------------|----------|--------------------------------------------------|
| `auth.oidc.issuerUrl`             | `string`   | Yes      | OIDC provider's issuer URL (must serve `/.well-known/openid-configuration`) |
| `auth.oidc.clientId`              | `string`   | Yes      | OAuth 2.0 client ID                              |
| `auth.oidc.clientSecret`          | `string`   | Yes      | OAuth 2.0 client secret                          |
| `auth.oidc.scopes`                | `string[]` | No       | Additional scopes to request (default: `openid profile email`) |
| `auth.oidc.roleMapping.claimPath` | `string`   | No       | Dot-notation path to the roles array in the ID token |
| `auth.oidc.roleMapping.superAdmin`| `string`   | No       | Claim value that maps to `super_admin` role      |
| `auth.oidc.roleMapping.admin`     | `string`   | No       | Claim value that maps to `admin` role            |
| `auth.oidc.roleMapping.editor`    | `string`   | No       | Claim value that maps to `editor` role           |

### Role Mapping from OIDC Claims

When `roleMapping` is configured, Gatewaze extracts roles from the ID token using the `claimPath` and maps them to internal admin roles.

**Claim path resolution example:**

For a token with the following structure:

```json
{
  "sub": "user-123",
  "email": "admin@example.com",
  "realm_access": {
    "roles": ["gatewaze-admin", "other-role"]
  }
}
```

With `claimPath: 'realm_access.roles'`, Gatewaze reads the array `["gatewaze-admin", "other-role"]` and checks for matches against `superAdmin`, `admin`, and `editor` values. The highest-privilege match wins:

1. `super_admin` (highest)
2. `admin`
3. `editor` (lowest)

If no role mapping is configured or no matching claims are found, the user's role defaults to the value stored in their `admin_profiles` record, or `editor` if no profile exists.

---

## Permissions System

Beyond the three admin roles, Gatewaze provides a fine-grained feature-based permission system.

### Admin Roles

| Role           | Description                                                    |
|----------------|----------------------------------------------------------------|
| `super_admin`  | Full access to all features, including user management, settings, and permissions administration |
| `admin`        | Access to most features. Cannot manage other admin users or change system settings |
| `editor`       | Limited access. Can create and edit content (events, speakers, etc.) but cannot access administrative functions |

Roles are stored in the `admin_profiles.role` column.

### Feature-Based Permissions

For more granular control, individual features can be granted or revoked per admin:

```sql
-- admin_permissions table
CREATE TABLE public.admin_permissions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  feature    text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (admin_id, feature)
);
```

**Example features:**

| Feature               | Description                              |
|-----------------------|------------------------------------------|
| `events.create`       | Create new events                        |
| `events.edit`         | Edit existing events                     |
| `events.delete`       | Delete events                            |
| `events.publish`      | Publish draft events                     |
| `speakers.manage`     | Manage speaker profiles                  |
| `members.manage`      | Manage member directory                  |
| `calendars.manage`    | Create and configure calendars           |
| `registrations.manage`| Manage event registrations               |
| `email.send`          | Send bulk or transactional email         |
| `settings.manage`     | Modify system settings                   |
| `users.manage`        | Create and manage admin users            |

Feature permissions are additive. An admin with the `editor` role and the `events.publish` permission can publish events even though `editor` does not normally have that capability.

### Permission Groups

Permission groups bundle multiple features for easy assignment:

```sql
-- admin_permission_groups table
CREATE TABLE public.admin_permission_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  features    text[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- admin_permission_group_assignments table
CREATE TABLE public.admin_permission_group_assignments (
  admin_id    uuid NOT NULL REFERENCES public.admin_profiles(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.admin_permission_groups(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, group_id)
);
```

**Example groups:**

```sql
-- Content Manager group
INSERT INTO admin_permission_groups (name, description, features)
VALUES (
  'Content Manager',
  'Can manage all content but not system settings',
  ARRAY['events.create', 'events.edit', 'events.publish', 'speakers.manage', 'calendars.manage']
);

-- Registration Manager group
INSERT INTO admin_permission_groups (name, description, features)
VALUES (
  'Registration Manager',
  'Can manage registrations and send email',
  ARRAY['registrations.manage', 'email.send']
);
```

Assign a group to an admin:

```sql
INSERT INTO admin_permission_group_assignments (admin_id, group_id, assigned_by)
VALUES ('admin-uuid', 'group-uuid', 'super-admin-uuid');
```

### Audit Trail

All permission changes are logged in the `admin_permission_audit` table:

```sql
CREATE TABLE public.admin_permission_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid,
  feature      text,
  action       text CHECK (action IN ('grant', 'revoke')),
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  details      jsonb
);
```

This provides an immutable record of who granted or revoked which permissions and when.

---

## RLS and External Auth Integration

When using an external OIDC provider instead of Supabase Auth, Row Level Security (RLS) policies need special handling since the user is not in Supabase's `auth.users` table.

### How it works

1. The API server authenticates the user via OIDC and obtains their identity.
2. The API server looks up the user's `admin_profiles` record by email.
3. For Supabase queries, the API server uses the **service role key** which bypasses RLS.
4. Authorization checks are performed at the application level using the permissions system.

### Service role key security

The `SERVICE_ROLE_KEY` bypasses all RLS policies. It must never be exposed to the client. Only server-side code (API server, worker, scheduler) should use it.

```typescript
// Server-side only
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

### Public portal RLS

The public portal uses the `anon` key with RLS policies that allow public read access to published events, active calendars, and related data. These policies work regardless of the auth provider because they do not depend on `auth.uid()`.

Example RLS policy for public event access:

```sql
CREATE POLICY "Public can view published events"
  ON public.events
  FOR SELECT
  TO anon
  USING (status = 'published');
```
