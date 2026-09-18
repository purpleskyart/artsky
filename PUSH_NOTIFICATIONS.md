# Push Notifications for PurpleSky

This document describes the push notification architecture and backend requirements for PurpleSky.

## Architecture Overview

```
┌─────────────┐      ┌─────────────────┐      ┌──────────────┐
│  PurpleSky  │◄────►│  Push Service   │◄────►│  Your Edge   │
│    (PWA)    │      │ (FCM/APNs/etc)  │      │  Backend     │
└─────────────┘      └─────────────────┘      └──────┬───────┘
                                                     │
                                              ┌──────┴───────┐
                                              │ Bluesky API  │
                                              │ (@atproto)   │
                                              └──────────────┘
```

## Frontend Components

The frontend implementation includes:

- **`src/sw.ts`** - Service worker with push notification handlers
- **`src/hooks/usePushNotifications.ts`** - Hook for managing push subscriptions
- **`src/context/PushNotificationsContext.tsx`** - Global state for notifications
- **`src/components/NotificationSettings.tsx`** - UI for notification preferences

## Backend Requirements

You need a backend service to:
1. Store push subscription data
2. Poll Bluesky for new notifications
3. Send push notifications via VAPID

### Environment Variables

Add to your `.env` file:

```
VITE_VAPID_PUBLIC_KEY=your_vapid_public_key_here
VITE_PUSH_API_ENDPOINT=https://your-api.com/api/push
```

### API Endpoints Required

Your backend must implement:

#### `POST /api/push/subscribe`
Register a new push subscription.

**Request Body:**
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "expirationTime": null,
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}
```

#### `POST /api/push/unsubscribe`
Remove a push subscription.

**Request Body:**
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/..."
  }
}
```

#### `POST /api/push/preferences`
Update notification preferences.

**Request Body:**
```json
{
  "preferences": {
    "enabled": true,
    "types": ["mention", "reply", "like"],
    "quietHours": {
      "enabled": true,
      "start": "22:00",
      "end": "08:00"
    }
  }
}
```

### Push Payload Format

When sending push notifications, use this payload structure:

```json
{
  "title": "New mention from @user",
  "body": "Hey, check out this artwork!",
  "icon": "https://your-cdn.com/icon-192.png",
  "badge": "https://your-cdn.com/icon-72.png",
  "tag": "mention-123",
  "requireInteraction": false,
  "data": {
    "url": "https://purplesky.app/profile/user.bsky.social/post/abc123",
    "notificationId": "abc123",
    "type": "mention"
  }
}
```

### VAPID Keys

Generate VAPID keys using web-push:

```bash
npx web-push generate-vapid-keys
```

Store the private key securely on your backend and use the public key in your frontend environment.

## Backend Implementation Example (Cloudflare Workers)

```typescript
// worker.ts
import webPush from 'web-push'

// Set VAPID keys
webPush.setVapidKeys(
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    
    // Handle subscription
    if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
      const { subscription } = await request.json()
      await env.SUBSCRIPTIONS.put(
        subscription.endpoint,
        JSON.stringify({
          subscription,
          createdAt: Date.now()
        })
      )
      return new Response('OK', { status: 201 })
    }
    
    // Handle unsubscription
    if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
      const { subscription } = await request.json()
      await env.SUBSCRIPTIONS.delete(subscription.endpoint)
      return new Response('OK', { status: 200 })
    }
    
    return new Response('Not Found', { status: 404 })
  },
  
  // Cron trigger to poll Bluesky
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    // Fetch all subscriptions
    const subscriptions = await env.SUBSCRIPTIONS.list()
    
    for (const key of subscriptions.keys) {
      const data = await env.SUBSCRIPTIONS.get(key.name)
      if (!data) continue
      
      const { subscription, blueskyDid, preferences } = JSON.parse(data)
      
      // Check quiet hours
      if (isQuietHours(preferences.quietHours)) continue
      
      // Poll Bluesky for new notifications
      const notifications = await fetchBlueskyNotifications(blueskyDid, env)
      
      // Send push for each new notification
      for (const notif of notifications) {
        if (!preferences.types.includes(notif.reason)) continue
        
        await webPush.sendNotification(
          subscription,
          JSON.stringify({
            title: formatNotificationTitle(notif),
            body: notif.text || 'New activity',
            icon: '/icon-192.png',
            data: {
              url: `/profile/${notif.author.handle}/post/${notif.uri.split('/').pop()}`,
              type: notif.reason
            }
          })
        )
      }
    }
  }
}
```

## Notification Types

| Type | Description |
|------|-------------|
| `mention` | Someone mentioned you in a post |
| `reply` | Someone replied to your post |
| `like` | Someone liked your post |
| `follow` | Someone followed you |
| `repost` | Someone reposted your post |
| `quote` | Someone quoted your post |

## Platform Support

| Platform | Support | Notes |
|----------|---------|-------|
| Android Chrome | ✅ Full | Best experience |
| Android Firefox | ✅ Full | Works well |
| iOS Safari | ✅ iOS 16.4+ | Must be installed as PWA |
| iOS Chrome | ❌ No | Uses WebKit engine, no push support |
| Desktop Chrome | ✅ Full | Less critical for mobile use case |
| Desktop Safari | ✅ macOS 13+ | Works when site is added to Dock |

## Testing

### Local Testing

1. Generate VAPID keys
2. Set `VITE_VAPID_PUBLIC_KEY` in `.env.local`
3. Start dev server: `npm run dev`
4. Open app in browser
5. Open DevTools → Application → Service Workers
6. Click "Push" to simulate a push notification

### Production Testing

1. Deploy backend with VAPID keys
2. Deploy frontend with `VITE_PUSH_API_ENDPOINT` set
3. Install PWA on mobile device
4. Enable notifications in settings
5. Use a second account to interact with your posts

## Troubleshooting

### Notifications not appearing

- Check browser permission in Settings → Site Settings → Notifications
- Verify service worker is registered in DevTools
- Check console for VAPID key errors
- Ensure HTTPS is used (required for push)

### iOS specific issues

- iOS requires PWA to be installed (Add to Home Screen)
- Push only works on iOS 16.4+
- Check Settings → Safari → Advanced → Experimental Features → "Notifications" is enabled

### Backend issues

- Verify VAPID keys are correctly set
- Check subscription endpoint is being stored
- Ensure push payload format matches expected structure
- Check server logs for web-push errors

## Security Considerations

1. Store VAPID private key securely (environment variable only)
2. Validate Bluesky DIDs before storing subscriptions
3. Rate limit push notifications per user
4. Encrypt subscription data at rest if storing in database
5. Implement subscription expiration/refresh logic

## Resources

- [Web Push API Spec](https://www.w3.org/TR/push-api/)
- [VAPID Spec](https://datatracker.ietf.org/doc/html/rfc8292)
- [web-push Node Library](https://github.com/web-push-libs/web-push)
- [Bluesky API Docs](https://docs.bsky.app/)
