# Send Push Notification Edge Function

Sends web push notifications to PWA users based on their stored subscriptions in Supabase.

## Overview

This function:
- Retrieves push subscriptions from the `push_subscriptions` table
- Sends web push notifications using the Web Push protocol
- Automatically marks invalid subscriptions as inactive (410 Gone)

## Environment Variables

Set these secrets for your Supabase project:

```bash
supabase secrets set VAPID_PUBLIC_KEY="your-public-key"
supabase secrets set VAPID_PRIVATE_KEY="your-private-key"
supabase secrets set VAPID_SUBJECT="mailto:support@yourdomain.com"
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
  "notification": {
    "title": "Event Starting Soon!",
    "body": "Your event starts in 30 minutes",
    "url": "/badge/event-123",
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

## Error Handling

- **410 Gone**: Subscription expired - automatically marked as `is_active = false`
- **400 Bad Request**: Missing required fields
- **404 Not Found**: No active subscriptions for user
- **500 Internal Server Error**: Push send failure

## Security

- Uses service role key to access push_subscriptions table
- VAPID private keys stored as Supabase secrets (never exposed)
- RLS policies protect user subscription data
- Endpoint URLs truncated in logs for privacy
