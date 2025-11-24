# Odinn.Browser

## Overview
Odinn.Browser is a professional desktop and web application designed for social media agencies to securely manage and access multiple OnlyFans accounts for their creators. Its primary purpose is to streamline workflows by providing quick access to accounts without repeated login entries, thereby reducing server load on OnlyFans by reusing existing sessions. The application aims to enhance efficiency for agency teams managing numerous creator accounts.

## User Preferences
I prefer detailed explanations.
I want iterative development.
Ask before making major changes.

## System Architecture
The application is built with a modern web stack: React, TypeScript, Tailwind CSS, shadcn/ui, and React Query for the frontend; Express.js and Node.js for the backend; and PostgreSQL with Drizzle ORM for the database. Zod is used for schema validation, and react-hook-form manages forms.

### UI/UX Decisions
The interface is inspired by Material Design 3, utilizing the Inter font for clean typography. It features a consistent design system with a blue primary color, semantic status colors, smooth hover animations, loading states with spinners, and toast notifications. The dashboard displays OnlyFans accounts in a responsive grid.

### Technical Implementations
- **Session Dashboard**: Displays account cards with avatars, names, usernames, and active status badges.
- **Session Management**: Supports importing sessions via JSON (single or bulk), deleting sessions with confirmation, and updating sessions via a PATCH endpoint.
- **OnlyFans Access**: Primarily via a Chrome Extension that uses the Cookies API to set cookies, enabling one-click access and automatic session setup. A fallback warning is displayed if the extension is not installed.
- **Activity Logging**: A complete audit trail of all CRUD operations is maintained with denormalized logging, ensuring logs persist even after session deletion. Logs can be filtered and display action type, timestamp, and session details.
- **Export Functionality**: Sessions can be exported to JSON (full data) or CSV (excluding sensitive fields) directly from the application.
- **External API Synchronization**: Features a robust, bidirectional sync system with external CRM/APIs. It includes manual sync, auto-sync every 5 minutes, and on-mount sync. Key aspects include atomic upsert logic using PostgreSQL `onConflictDoUpdate`, `xmax`-based detection for reliable INSERT vs. UPDATE, cookie normalization, race condition protection with `isPending` guards, debouncing, and toast notifications for feedback.
- **OFAuth API Integration**: Complete server-side integration with OFAuth API for secure dynamic OnlyFans API header generation. Desktop app requests headers from server, which calls OFAuth API. Architecture: Desktop → Server `/api/generate-ofauth-headers` → OFAuth API. Features include:
  - **Server-Side Generation**: OFAUTH_API_KEY stays on server (Replit Secrets), never exposed to desktop app
  - **Automatic Header Injection**: webRequest interceptor in desktop app detects OnlyFans API calls and requests headers from server
  - **Smart Caching**: Headers cached on both server and desktop app (10 seconds each) to minimize API calls
  - **Session-Specific Headers**: Combines OFAuth dynamic headers (sign, time, app-token, x-of-rev) with session-specific data (x-bc device fingerprint, cookies) added locally
  - **CRITICAL**: User ID is passed to OFAuth for signature generation but is NOT sent as a header. User identification happens via `auth_id` cookie only. Adding `user-id` header causes 400 errors.
  - **No Origin Header**: OnlyFans rejects API requests with `Origin` header for same-origin requests. Header must be omitted.
  - **Fallback Support**: Falls back to static headers (x-bc, app-token) if server/OFAuth API unavailable
  - **Secure Architecture**: Desktop app connects to `https://session-of.replit.app` by default (configurable via SERVER_URL env var)
  - **Rate Limits**: 30 requests/minute to OFAuth Sign API endpoint, mitigated by dual-layer caching
- **Electron Desktop App**: Provides a full desktop application experience with the following features:
  - **Session Sidebar**: Left sidebar displaying all available OnlyFans accounts with avatars, names, usernames, and emails
  - **One-Click Account Switching**: Click any account to instantly load it in a full-screen BrowserView
  - **Isolated Cookie Partitions**: Each session uses a unique Chromium partition (`persist:onlyfans-{sessionId}`) for complete cookie isolation
  - **Live Sync Button**: Manual sync button in sidebar to fetch latest sessions from external API
  - **Auto-Sync**: Automatically syncs sessions from API on app startup
  - **BrowserView Integration**: Full Chromium BrowserView embedded directly in the app, giving complete control over navigation and cookies
  - **Loading Indicator**: Beautiful loading overlay with spinner while OnlyFans page loads, eliminating white screen issue
  - **Smart View Loading**: BrowserView appears only after OnlyFans page fully loads, preventing white screen flash
  - **Close Controls**: ESC key or dedicated button to close OnlyFans and return to sidebar
  - **Server Configuration**: Initial setup screen to connect to web server, defaults to `https://session-of.replit.app`
  - **Modern UI**: Dark theme with gradient backgrounds, smooth animations, and Material Design 3 inspired components
- **DMG Auto-Build**: Integrates with GitHub Actions for automated DMG (macOS installer) builds, including a web interface (`/build-dmg`) to trigger builds, monitor status, and download finished files. Supports universal builds (Intel + Apple Silicon). Features GitHub Releases integration with direct download links, file size info, download counts, and public access without authentication required.
- **Theme System**: Full dark/light theme support with ThemeProvider. Users can switch between light, dark, and system themes via a dropdown toggle in the header. Theme preference is persisted in localStorage.
- **Internationalization (i18n)**: Complete bilingual support for English and Russian languages. Language toggle in header allows instant switching between languages. All UI strings are translated via the i18n system. Language preference is persisted in localStorage. Default language is Russian.

### System Design Choices
- **Database Persistence**: Utilizes PostgreSQL with Drizzle ORM for robust data storage, migrating from in-memory solutions.
- **API Endpoints**: Comprehensive RESTful API for session management (`GET`, `POST`, `PATCH`, `DELETE`), activity logs, export functions, and external API synchronization.
- **Data Model**: Clearly defined data models for OnlyFans Sessions (UUID for `id`, `platformUserId`, `xBc`, `cookie`, `userId`, `userAgent`) and denormalized Activity Logs (preserving session details after deletion).
- **Security**: Sessions are persisted in PostgreSQL, and sensitive data is intended to be encrypted at rest in production. CSV exports exclude sensitive fields, while JSON exports include full data for backup.
- **CORS Configuration**: Backend includes CORS middleware that supports both web browsers and Electron Desktop app. For Electron/file:// origins, returns `Access-Control-Allow-Origin: null` without credentials header (CORS spec compliant). For web origins, echoes the origin with credentials enabled.

## External Dependencies
- **PostgreSQL**: Primary database for all persistent data.
- **OnlyFans**: The platform for which sessions are managed.
- **OFAuth API**: Provides cryptographic signing for OnlyFans API requests (https://api.ofauth.com), OFAUTH_API_KEY stored in Replit Secrets.
- **Chrome Extension**: Custom browser extension for direct cookie manipulation and session access.
- **External CRM/API**: Used for bidirectional synchronization of session data, configured via `SYNC_API_URL` and `SYNC_API_KEY` environment variables.
- **GitHub Actions**: Utilized for automated DMG builds for the Electron desktop application.
- **@octokit/rest SDK**: Used for interacting with the GitHub API.