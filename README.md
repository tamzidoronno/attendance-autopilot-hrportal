# Attendance Autopilot

Checks you in and out of the attendance portal on your schedule. It picks up your
session automatically whenever you use the portal, so signing in once a month keeps it working.

## Before installing (once, by whoever distributes it)
1. Set `PORTAL_ORIGIN` in `config.js` and the same origin in `host_permissions` in `manifest.json`.
2. Fill in the real check-in / check-out endpoints in `config.js` (copy them from DevTools).
3. If remote-work applications have a status, update `isApproved` in `config.js`.

## Install
1. Open `chrome://extensions`, turn on Developer mode.
2. Click **Load unpacked** and pick this folder.
3. Sign in to the portal. The popup should show your name and session expiry.
4. Pick your times and days, then turn the switch on.

## Good to know
- Runs in the background with no Chrome window open: Chrome keeps running after you close its
  windows. Keep "Continue running background apps when Google Chrome is closed" on
  (chrome://settings/system). On Windows and Linux Chrome starts with your login; on macOS it
  does not, so add Chrome to Login Items (System Settings > General > Login Items) or open it
  once after you start your computer.
- The computer must be on. If it's off at check-in time, check-in happens when it's back on,
  up until check-out time. Check-out runs any time after check-out time until midnight.
- Selected weekdays always run. With "Also on remote-work application days" on, other days
  run too if you have a remote-work application for that day.
- You get a notification for every check-in/out, any failure, and 3 days before the session expires.
- Everything is stored locally in the browser. Nothing is sent anywhere except the portal.

## If your computer was off or asleep at the scheduled time
Nothing is missed while the computer is on again with Chrome running, but the portal records
the time the call is actually made, not the scheduled time. Example with check-in 09:00 and
check-out 18:00:

| You open the computer at | What happens |
|---|---|
| Before 09:00 | Check-in runs at 09:00 as normal. |
| 10:00 | Within about a minute of Chrome starting, check-in runs and the portal shows **10:0x**. |
| 17:59 | Check-in runs late, then check-out runs at 18:00. |
| After 18:00 | Check-in is **not** run (its window ended at check-out time). Only check-out runs, so that day has a check-out and no check-in. Fix it in the portal. |

Other cases:
- If your portal session has expired, nothing runs. You get a notification, and the action runs
  right after you sign in to the portal.
- If a check-in worked but a check-out never happened, you get a "Check-out missing"
  notification the next day.
- A manual **Check in now** / **Check out now** works at any time and counts for the day.

## Security and privacy
- To act as you, the extension reuses the portal session token your browser already has. That token
  is a full-account credential valid for 30 days, so treat it like a password.
- The token is stored only in `chrome.storage.local` in your browser, never in this repo, and
  it is never logged or shown in the popup or notifications.
- The extension talks only to the portal API configured in `config.js`. It has no server, no
  analytics and no remote storage. Settings, today's status and the activity log stay on your computer.
- Anyone with access to your Chrome profile (or malware running as you) could read the token.
  Use a locked computer and a separate Chrome profile for work if that worries you.
- Remove the extension to delete all stored data. Signing out of the portal does not revoke the
  token, so it stays valid until it expires.
- Only install builds you got from a source you trust. A modified copy could send your token elsewhere.
  Check `host_permissions` in `manifest.json` lists only your portal.
- Check that your employer allows automated check-ins before using this. You are responsible for
  the attendance records it creates.
