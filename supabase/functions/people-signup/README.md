# User Signup Edge Function

Generic, reusable edge function for creating users with Customer.io-first approach across all Gatewaze applications.

## Overview

This edge function provides a unified signup flow that:
1. Creates users in Customer.io first (source of truth for customer data)
2. Waits for Customer.io webhook to create Supabase auth user
3. Supports custom attributes including UTM parameters for campaign tracking
4. Works across multiple applications (cohorts, app, etc.)

## Endpoint

```
POST /functions/v1/user-signup
```

## Request Body

```typescript
{
  email: string                // Required - user's email address
  user_metadata?: {            // Optional - user profile data
    first_name?: string
    last_name?: string
    company?: string
    job_title?: string
    full_name?: string
    avatar_url?: string
    provider?: string          // OAuth provider (google, github)

    // UTM Parameters (automatically captured)
    utm_source?: string
    utm_medium?: string
    utm_campaign?: string
    utm_term?: string
    utm_content?: string

    // Any custom fields
    [key: string]: any
  }
  source: string              // Required - signup source identifier
  app?: string                // Optional - application identifier
}
```

## Response

```typescript
{
  success: boolean
  message: string
  customer_id?: string        // Supabase customer ID
  cio_id?: string            // Customer.io customer ID
  missing_fields?: string[]   // Fields needed for profile completion
  user_id?: string           // Supabase auth user ID
  error?: string
}
```

## Source Naming Convention

The `source` parameter should follow the pattern: `{app}_{signup_method}`

Examples:
- `cohorts_email_signup` - Email signup from cohorts app
- `cohorts_google_oauth` - Google OAuth from cohorts app
- `cohorts_github_oauth` - GitHub OAuth from cohorts app
- `app_event_checkin` - Event check-in from main app
- `app_magic_link` - Magic link signin from main app

## Custom Attributes

The function accepts **any custom attributes** in the `user_metadata` object. These will be stored in the Customer.io customer profile and synced to Supabase.

### Common Use Cases

#### 1. UTM Campaign Tracking

```typescript
{
  email: "user@example.com",
  source: "cohorts_email_signup",
  user_metadata: {
    utm_source: "facebook",
    utm_medium: "cpc",
    utm_campaign: "spring_sale_2024",
    utm_content: "ad_variant_a"
  }
}
```

#### 2. Referral Tracking

```typescript
{
  email: "user@example.com",
  source: "cohorts_referral",
  user_metadata: {
    referrer_id: "usr_abc123",
    referral_code: "FRIEND20",
    referral_source: "email"
  }
}
```

#### 3. A/B Test Variant

```typescript
{
  email: "user@example.com",
  source: "cohorts_email_signup",
  user_metadata: {
    ab_test_variant: "variant_b",
    ab_test_name: "signup_flow_v2",
    landing_page: "homepage_v2"
  }
}
```

#### 4. Event Registration with Discount

```typescript
{
  email: "user@example.com",
  source: "app_event_registration",
  user_metadata: {
    event_id: "evt_mlops2024",
    discount_code: "EARLYBIRD",
    ticket_type: "vip",
    registration_date: "2024-01-15"
  }
}
```

## Usage Examples

### From Cohorts App

```typescript
import { CustomerIOService } from '@/services/customerioService';

// Basic signup
await CustomerIOService.signup(
  'user@example.com',
  {},
  'email_signup'
);

// Signup with UTM tracking (auto-extracted from URL)
const utmParams = CustomerIOService.extractUTMParams();
await CustomerIOService.signup(
  'user@example.com',
  utmParams,
  'email_signup'
);

// OAuth signup with custom attributes
await CustomerIOService.signup(
  'user@example.com',
  {
    first_name: 'John',
    last_name: 'Doe',
    avatar_url: 'https://...',
    provider: 'google',
    signup_variant: 'social_buttons_v2'
  },
  'google_oauth'
);
```

### From Main App

```typescript
// Event check-in with custom tracking
const response = await fetch('/functions/v1/user-signup', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${anonKey}`
  },
  body: JSON.stringify({
    email: 'attendee@example.com',
    source: 'app_event_checkin',
    app: 'app',
    user_metadata: {
      first_name: 'Jane',
      last_name: 'Smith',
      company: 'Acme Corp',
      job_title: 'Engineer',
      event_id: 'mlops2024',
      check_in_location: 'San Francisco',
      utm_source: 'event_email',
      utm_campaign: 'mlops2024_reminders'
    }
  })
});
```

## Customer.io Data Structure

All attributes are stored in Customer.io under the customer profile:

```json
{
  "id": "cohorts_1234567890_abc123",
  "email": "user@example.com",
  "created_at": 1234567890,
  "attributes": {
    // Standard fields
    "first_name": "John",
    "last_name": "Doe",
    "company": "Acme Corp",
    "job_title": "Software Engineer",

    // System fields
    "source": "cohorts_email_signup",
    "signup_source": "cohorts_email_signup",
    "signup_platform": "cohorts",

    // UTM parameters
    "utm_source": "facebook",
    "utm_medium": "cpc",
    "utm_campaign": "spring_sale_2024",

    // Any custom fields
    "referral_code": "FRIEND20",
    "ab_test_variant": "variant_b"
  }
}
```

## Supabase Data Structure

The same attributes are synced to Supabase `customers` table:

```sql
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  cio_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  auth_user_id UUID REFERENCES auth.users(id),
  attributes JSONB,  -- All custom attributes stored here
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Query example:
```sql
-- Find all users from a specific campaign
SELECT * FROM customers
WHERE attributes->>'utm_campaign' = 'spring_sale_2024';

-- Find all users who signed up via referral
SELECT * FROM customers
WHERE attributes->>'referral_code' IS NOT NULL;

-- Find all event attendees
SELECT * FROM customers
WHERE attributes->>'event_id' IS NOT NULL;
```

## URL Parameter Extraction

The cohorts app automatically extracts and stores URL parameters during signup:

```
https://cohorts.mlops.community/auth?utm_source=linkedin&utm_campaign=ai_summit&referral=abc123
```

Automatically captured:
- `utm_source` → "linkedin"
- `utm_campaign` → "ai_summit"
- `referral` → "abc123"

## Best Practices

### 1. Consistent Naming

Use lowercase with underscores:
```typescript
// Good
utm_source, referral_code, event_id

// Bad
UTMSource, referralCode, EventID
```

### 2. Source Identification

Always include app name in source:
```typescript
// Good
'cohorts_email_signup', 'app_event_checkin'

// Bad
'email', 'signup', 'oauth'
```

### 3. Date Fields

Use ISO 8601 format for dates:
```typescript
{
  registration_date: new Date().toISOString() // "2024-01-15T10:30:00Z"
}
```

### 4. Avoid PII in UTM

Don't include personally identifiable information in UTM parameters:
```typescript
// Bad
utm_content: 'user_email_john@example.com'

// Good
utm_content: 'email_variant_a'
```

## Error Handling

### Timeout Error (408)

```json
{
  "success": false,
  "error": "Timeout waiting for user creation",
  "message": "Please try again in a moment"
}
```

**Cause:** Customer.io webhook didn't complete within 60 seconds

**Solution:** User should retry. Customer may already exist in Customer.io, so retry will succeed.

### Missing Source (400)

```json
{
  "error": "Source required (e.g., \"cohorts_email_signup\", \"app_google_oauth\")"
}
```

**Cause:** `source` parameter not provided

**Solution:** Always include source parameter with proper naming

### Customer.io API Error (500)

```json
{
  "success": false,
  "error": "Customer.io API error: ...",
  "message": "Signup failed"
}
```

**Cause:** Customer.io API request failed

**Solution:** Check Customer.io credentials in environment variables

## Environment Variables

```bash
# Required
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
CUSTOMERIO_SITE_ID=...
CUSTOMERIO_API_KEY=...
```

## Deployment

```bash
cd /Users/dan/Git/gatewaze/gatewaze-admin
supabase functions deploy user-signup
```

## Testing

### Test Email Signup with UTM

```bash
curl -X POST https://db.mlops.community/functions/v1/user-signup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <anon-key>" \
  -d '{
    "email": "test@example.com",
    "source": "cohorts_email_signup",
    "app": "cohorts",
    "user_metadata": {
      "utm_source": "test",
      "utm_campaign": "test_campaign"
    }
  }'
```

### Test OAuth Signup

```bash
curl -X POST https://db.mlops.community/functions/v1/user-signup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <anon-key>" \
  -d '{
    "email": "test@example.com",
    "source": "cohorts_google_oauth",
    "app": "cohorts",
    "user_metadata": {
      "first_name": "John",
      "last_name": "Doe",
      "full_name": "John Doe",
      "avatar_url": "https://...",
      "provider": "google"
    }
  }'
```


## Support

For issues or questions:
- Check edge function logs in Supabase dashboard
- Verify Customer.io webhook logs
- Confirm environment variables are set correctly
- Test with curl to isolate frontend issues
