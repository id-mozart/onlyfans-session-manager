# OFAuth Desktop App Architecture

**Status:** ✅ Production Ready  
**Date:** November 23, 2025  
**Architecture:** Server-Side Header Generation (Secure)

## Overview

Desktop Electron app получает OnlyFans signed headers через централизованный server endpoint вместо прямого обращения к OFAuth API. Это обеспечивает безопасность и простоту развёртывания.

## Architecture Diagram

```
┌─────────────────┐
│  Desktop App    │
│  (.dmg file)    │
└────────┬────────┘
         │ POST /api/generate-ofauth-headers
         │ { endpoint, userId }
         ▼
┌─────────────────────────────────┐
│  Replit Server                  │
│  https://session-of.replit.app  │
│                                 │
│  - Has OFAUTH_API_KEY           │
│  - Generates headers            │
│  - Returns to desktop app       │
└────────┬────────────────────────┘
         │ POST https://api.ofauth.com/v2/dynamic-rules/sign
         │ Headers: { apiKey: OFAUTH_API_KEY }
         ▼
┌─────────────────┐
│   OFAuth API    │
│  api.ofauth.com │
└─────────────────┘
```

## Benefits

✅ **Security:** OFAUTH_API_KEY никогда не попадает в desktop app или DMG файл  
✅ **Simplicity:** Desktop app работает из коробки без дополнительной конфигурации  
✅ **Centralization:** Один endpoint для всех desktop app instances  
✅ **Caching:** Server кэширует headers на 10 секунд  
✅ **Maintenance:** Обновления OFAuth integration делаются только на server

## Server Implementation

### Endpoint: `POST /api/generate-ofauth-headers`

**Location:** `server/routes.ts:968-1037`

**Request Body:**
```json
{
  "endpoint": "https://onlyfans.com/api2/v2/users/me",
  "userId": "123456"  // optional
}
```

**Response:**
```json
{
  "success": true,
  "headers": {
    "sign": "50660:c20119ceb...",
    "time": "1763939853360",
    "app-token": "33d57ade8c02dbc5a333db99ff9ae26a",
    "x-of-rev": "202511201203-cf8388bbdd"
  }
}
```

**Error Response:**
```json
{
  "error": "OFAUTH_API_KEY not configured on server"
}
```

## Desktop App Implementation

### File: `desktop/main.js`

**Function:** `generateOnlyFansHeaders(urlPath, userId)`

**Key Changes:**
1. Removed direct OFAuth API calls
2. Now calls `${SERVER_URL}/api/generate-ofauth-headers`
3. `SERVER_URL` defaults to `https://session-of.replit.app`
4. Can be overridden with environment variable: `SERVER_URL=http://localhost:5000`

**Code Flow:**
```javascript
// 1. Check cache (10 second TTL)
if (cached && fresh) return cached.headers;

// 2. Call server endpoint
const response = await fetch(`${SERVER_URL}/api/generate-ofauth-headers`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ endpoint: fullEndpoint, userId })
});

// 3. Extract headers from response
const { headers } = await response.json();

// 4. Cache and return
headersCache.set(cacheKey, { headers, timestamp: Date.now() });
return headers;
```

## Environment Variables

### Server (Replit)
- `OFAUTH_API_KEY` - Required, stored in Replit Secrets

### Desktop App (Optional)
- `SERVER_URL` - Override default server URL (default: `https://session-of.replit.app`)

## Testing

### Test Server Endpoint
```bash
curl -X POST https://session-of.replit.app/api/generate-ofauth-headers \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://onlyfans.com/api2/v2/users/me","userId":"123456"}'
```

**Expected Response:**
```json
{
  "success": true,
  "headers": {
    "sign": "...",
    "time": "...",
    "app-token": "...",
    "x-of-rev": "..."
  }
}
```

## Deployment

### Server (Automatic)
- ✅ Already deployed on Replit
- ✅ OFAUTH_API_KEY configured in Secrets
- ✅ Endpoint available at: `https://session-of.replit.app/api/generate-ofauth-headers`

### Desktop App (DMG Build)
1. Push changes to GitHub
2. Trigger GitHub Actions build: https://session-of.replit.app/build-dmg
3. Download and install DMG
4. App automatically connects to production server

## Monitoring & Debugging

### Server Logs
```bash
# On Replit, check workflow logs
11:16:51 PM [express] serving on port 5000
✅ OFAuth: headers сгенерированы для /api2/v2/users/me
```

### Desktop App Logs
```javascript
// Success
✅ OFAuth: headers получены от сервера для /api2/v2/users/me

// Error
❌ Server error generating headers (500): { error: "..." }
❌ Invalid server response - missing headers
❌ Ошибка получения OFAuth headers от сервера: Error...
```

## Security Considerations

1. **API Key Protection:**
   - ✅ OFAUTH_API_KEY never exposed in desktop app
   - ✅ Only stored in Replit Secrets
   - ✅ Never logged or returned to client

2. **Rate Limiting:**
   - OFAuth API: 30 requests/minute
   - Server caching: 10 seconds
   - Desktop app caching: 10 seconds
   - Effective rate: ~6 requests/minute per desktop app

3. **HTTPS:**
   - ✅ Desktop → Server: HTTPS
   - ✅ Server → OFAuth: HTTPS

## Troubleshooting

### Desktop App Can't Connect to Server
**Symptom:** Connection loop or timeout errors

**Solutions:**
1. Check `SERVER_URL` is set correctly (default: `https://session-of.replit.app`)
2. Verify server is running: `curl https://session-of.replit.app/api/sessions`
3. Check internet connection

### Headers Not Generated
**Symptom:** `❌ Server error generating headers (500)`

**Solutions:**
1. Check OFAUTH_API_KEY is set on server
2. Verify OFAuth API is accessible
3. Check server logs for detailed error message

### 400 Bad Request from OnlyFans
**Symptom:** OnlyFans API returns 400 after headers are injected

**Solutions:**
1. Verify `x-bc`, `user-id`, cookies are set correctly
2. Check User-Agent matches session data
3. Ensure localStorage has `deviceId` set

## Migration from Direct OFAuth Integration

**Old Architecture (Insecure):**
```
Desktop App → OFAuth API (needs OFAUTH_API_KEY in app)
```

**New Architecture (Secure):**
```
Desktop App → Server → OFAuth API (OFAUTH_API_KEY stays on server)
```

**Migration Steps:**
1. ✅ Created server endpoint: `/api/generate-ofauth-headers`
2. ✅ Updated `desktop/main.js`: removed direct OFAuth calls
3. ✅ Changed `SERVER_URL` default to production
4. ✅ Tested endpoint successfully

## Related Files

- `server/routes.ts` - Server endpoint implementation
- `desktop/main.js` - Desktop app OFAuth integration
- `OFAUTH_INTEGRATION_SUMMARY.md` - Original OFAuth documentation
- `replit.md` - Project overview

## Status

**✅ Complete & Production Ready**

All components tested and working:
- ✅ Server endpoint generates headers correctly
- ✅ Desktop app updated to use server
- ✅ OFAUTH_API_KEY secured on server
- ✅ Ready for DMG build & deployment
