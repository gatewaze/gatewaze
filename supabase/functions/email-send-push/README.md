# Send Push Notification Edge Function

Sends web push notifications to PWA users based on their stored subscriptions in Supabase.

## Overview

This function:
- Retrieves push subscriptions from the `push_subscriptions` table
- Sends web push notifications using the Web Push protocol
- Automatically marks invalid subscriptions as inactive (410 Gone)
- Works with both tech.tickets and MLOps brands (separate VAPID keys)

## Environment Variables

Each brand has its own Supabase project. Set these secrets for each project:

### tech.tickets (`qjzldkohlokymerlobfc`)

```bash
supabase secrets set VAPID_PUBLIC_KEY="BCNc0ys_kURCSOq-JRrO3_G942b0OLjWNIgjtaMWvgi9E8QE3jT-80G6e79vl6wU4vsueuWwgm8S8jEKtWhKKOc" --project-ref qjzldkohlokymerlobfc
supabase secrets set VAPID_PRIVATE_KEY="u4h6Ci0rD7HZ_pVnWskZmrgRKVp8OLV43BOjRG9vqSg" --project-ref qjzldkohlokymerlobfc
supabase secrets set VAPID_SUBJECT="mailto:support@tech.tickets" --project-ref qjzldkohlokymerlobfc
```

### MLOps (`wdewqtcctpdqxypwnlhp`)

```bash
supabase secrets set VAPID_PUBLIC_KEY="BB7qeIcQDo94ap3_7pL-vu9eIDFV-XczgLJYKx3jYY0SyECF6XA1BsWGm3DOIRQmuEwoQthc2gm-OjB2982yL2M" --project-ref wdewqtcctpdqxypwnlhp
supabase secrets set VAPID_PRIVATE_KEY="h3jl_BrcDt8Kfw8bE2JmFrjk14Lfb0ZW6brKyng88nU" --project-ref wdewqtcctpdqxypwnlhp
supabase secrets set VAPID_SUBJECT="mailto:support@mlops.community" --project-ref wdewqtcctpdqxypwnlhp
```

## Deployment

```bash
supabase functions deploy send-push
```

## API

### Endpoint

```
POST https://YOUR_PROJECT.supabase.co/functions/v1/send-push
```

### Headers

```
Authorization: Bearer YOUR_SUPABASE_ANON_KEY
Content-Type: application/json
```

### Request Body

```json
{
  "email": "user@example.com",
  // OR
  "customer_id": "123",

  "notification": {
    "title": "Event Starting Soon!",
    "body": "Your event starts in 30 minutes",
    "url": "/badge/event-123",
    "icon": "/img/favicon/techtickets/android-icon-192x192.png",
    "badge": "/img/favicon/techtickets/android-icon-96x96.png",
    "tag": "event-reminder",
    "requireInteraction": false,
    "data": {
      "event_id": "event-123"
    }
  }
}
```

### Response

```json
{
  "message": "Push notifications processed",
  "successful": 2,
  "failed": 0,
  "total": 2,
  "notification": {
    "title": "Event Starting Soon!",
    "body": "Your event starts in 30 minutes"
  },
  "results": [
    {
      "success": true,
      "endpoint": "https://fcm.googleapis.com/fcm/send/...",
      "platform": "Chrome"
    }
  ]
}
```

## Usage Examples

### From Customer.io Webhook

Configure a webhook in Customer.io:
- URL: `https://YOUR_PROJECT.supabase.co/functions/v1/send-push`
- Headers: `Authorization: Bearer YOUR_ANON_KEY`
- Body:
```json
{
  "email": "{{customer.email}}",
  "notification": {
    "title": "{{campaign.title}}",
    "body": "{{campaign.message}}",
    "url": "{{campaign.url}}"
  }
}
```

### From Your App

```typescript
const { data, error } = await supabase.functions.invoke('email-send-push', {
  body: {
    email: 'user@example.com',
    notification: {
      title: 'Badge Scanned!',
      body: 'Someone scanned your badge',
      url: '/scan-history',
    },
  },
});
```

### From Database Trigger

```sql
CREATE OR REPLACE FUNCTION notify_on_badge_scan()
RETURNS TRIGGER AS $$
DECLARE
  scanner_email TEXT;
BEGIN
  -- Get scanner's email
  SELECT email INTO scanner_email
  FROM customers
  WHERE id = NEW.scanner_customer_id;

  -- Send push notification
  PERFORM net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object(
      'email', scanner_email,
      'notification', jsonb_build_object(
        'title', 'Badge Scanned!',
        'body', 'You scanned a new contact',
        'url', '/scan-history'
      )
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## Testing Locally

```bash
# Start Supabase locally
supabase start

# Serve function
supabase functions serve send-push

# Test
curl -X POST http://localhost:54321/functions/v1/send-push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "email": "test@example.com",
    "notification": {
      "title": "Test",
      "body": "Hello from Supabase!"
    }
  }'
```

## Multi-Brand Architecture

Each brand (tech.tickets and MLOps) has its own Supabase project with its own:
- `push_subscriptions` table
- VAPID keys (configured as environment variables)
- Deployed `send-push` edge function

This ensures complete separation between brands and simplified configuration.

## Error Handling

- **410 Gone**: Subscription expired - automatically marked as `is_active = false`
- **400 Bad Request**: Missing required fields
- **404 Not Found**: No active subscriptions for user
- **500 Internal Server Error**: Push send failure

## Monitoring

Check function logs:
```bash
supabase functions logs send-push
```

## Security

- Uses service role key to access push_subscriptions table
- VAPID private keys stored as Supabase secrets (never exposed)
- RLS policies protect user subscription data
- Endpoint URLs truncated in logs for privacy
