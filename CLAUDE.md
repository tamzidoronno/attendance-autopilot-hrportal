# Attendance Autopilot — Chrome extension (MV3)

Automates check-in / check-out on our company attendance portal. The portal only allows Google sign-in and a manual "check in" click; this extension reuses the portal's own session token to call the check-in/out APIs on a schedule.

It's meant for **anyone** who uses the portal, not one person: no hardcoded user, no server, no database. Everything lives in `chrome.storage.local` in each user's browser.

## How the portal auth works (verified)

- Google sign-in → `POST {API}/api/Authentication/Google` with body `{ "GoogleTokenID": "<google id token>" }`
- Response: `{ name, email, role, token, hasAdminPermission, hasHrPermission, hasTeamManagerPermission, id }`
- `token` is the portal's own JWT, sent as `Authorization: Bearer <token>` on every `/api/*` call.
- JWT: HS256, **30-day lifetime** (`exp - iat = 2592000`), no refresh token. Payload claims: `nameid` (user id, string), `role`, `email`, `name`, `displayName`, permission flags, `nbf`, `exp`, `iat`. No `iss`.
- The user signs in at least once a month, which is why capturing the token on each portal visit is enough.

## Other APIs

- Profile: `GET {API}/api/Users/{userId}/profile`, called when `{PORTAL}/attendance` is opened.
- Remote work: `GET {API}/api/Users/{userId}/RemoteWorkApplications?fromDate=2026-Oct-16&toDate=2026-Oct-16`
  - Query date format is `YYYY-Mon-DD`.
  - Returns an array with **one item only if there's an application for that day**, otherwise empty.
  - Item `fromDate` looks like `"2026-10-16T00:00:00"` (no timezone). Compare with `.slice(0, 10)` against local `YYYY-MM-DD`.
- Check-in / check-out: **endpoints, methods and bodies not confirmed yet.** Placeholders are in `config.js`. Ask the user to copy them from DevTools, or find them if the portal's frontend source is available.

## Required behaviour

- **Token capture:** whenever the user visits the portal while signed in, store the newest valid portal JWT and its user id (`nameid`, falling back to the id in `/api/Users/{id}/` URLs). Ignore Google's own ID tokens.
- **Settings (popup):**
  - Master on/off switch.
  - Check-in time and check-out time; check-out must be later than check-in.
  - Weekday selector, Sun–Sat (default Sun–Thu).
  - Checkbox **"Also on remote-work application days"**. This is *additional*, not a filter: selected weekdays always run; on unselected days, run only if the remote-work API returns an application for today.
- **Scheduling:**
  - Check-in window: from check-in time until check-out time. If the computer was off at check-in time, check in when it's back, but never after check-out time.
  - Check-out window: from check-out time until midnight.
  - Each action runs at most once per day.
- **Runs in the background:** uses the `background` permission so Chrome keeps running with no window open. It can't run with the computer off; the user accepted that trade-off over a server for now.
- **Failure handling:**
  - Network errors or 5xx: retry up to 3 times, about a minute apart.
  - 401/403 or an expired token: mark the action "needs sign-in" and run it immediately once a fresh token is captured.
  - Other 4xx: fail and notify.
- **Notifications:**
  - Success and failure of each action.
  - Session expiring in 3 days or less (once per day).
  - A check-in with no check-out on the previous day.
  - Clicking a notification focuses the portal tab.
- **"Open portal"** focuses and reloads an existing portal tab instead of opening a new one.
- **Manual "Check in now" / "Check out now"** buttons in the popup, with a two-click confirm.

## Code layout

- `manifest.json`: MV3; permissions `storage`, `alarms`, `notifications`, `webRequest`, `background`; host permissions; content script.
- `config.js`: `PORTAL_ORIGIN`, `API_ORIGIN`, API specs, `isApproved` hook for remote-work items, retry and warning constants.
- `shared.js`: default settings, JWT decode, date helpers.
- `background.js`: module service worker.
  - Captures the token via `webRequest.onBeforeSendHeaders` on `{API_ORIGIN}/api/*`, and via content-script messages.
  - Runs a 1-minute `chrome.alarms` tick that holds the scheduling logic, makes the API calls, and handles daily state, logging and notifications.
- `content.js`: on portal pages, scans localStorage, sessionStorage and cookies for JWTs and sends them to the background worker.
- `popup.html`, `popup.css`, `popup.js`: settings UI, today's status as a time card, activity log. Supports light and dark themes.

Storage keys:
- `auth`: `{ token, userId, name, email, exp, savedAt }`
- `settings`
- `day`: `{ date, checkin, checkout, remote }`; step status is one of `pending`, `ok`, `failed`, `blocked`, `skipped`.
- `log`: last 40 entries.
- `expiryWarnedOn`

No build step; plain ES modules. Keep it that way unless there's a strong reason.

## Current status / open issue

- Installed unpacked. The popup shows **"Not connected yet"** even though the portal tab is signed in, so the token isn't being captured.
- Likely causes:
  - `PORTAL_ORIGIN` / `API_ORIGIN` / `host_permissions` / `content_scripts.matches` don't exactly match the real hosts. They may still be `attendance.example.com`, or the API may be on a different host than the page.
  - The portal stores the token somewhere the content script doesn't scan, such as IndexedDB or in-memory only.
- A fix adding `API_ORIGIN` and the content-script capture path was just made but not yet tested.
- **Start here:**
  1. Get the real page origin and API origin.
  2. Set all four places consistently.
  3. Reload the extension and check the service worker console for errors.
  4. Confirm the token gets captured.
  5. Confirm the check-in/out endpoints and test with the manual buttons.

## Rules

- Never commit, log, or print real tokens. Don't put them in test fixtures or console output.
- Don't add a server or remote storage without asking. Tokens are a 30-day full-account credential, so a central store holding everyone's tokens needs an explicit decision.
- Keep all user data local to the browser; the only network calls go to the portal API.
