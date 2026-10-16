import { PORTAL_ORIGIN, API_ORIGIN, API, MAX_ATTEMPTS, EXPIRY_WARN_DAYS } from "./config.js";
import { DEFAULT_SETTINGS, decodeJwt, ymd, apiDate, minutesOf, hhmm } from "./shared.js";

const store = chrome.storage.local;
let running = false;

// ───────────── Session capture ─────────────
// Every authenticated portal request carries the bearer token; keep the newest one.
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.initiator?.startsWith("chrome-extension://")) return; // our own calls
    const header = details.requestHeaders?.find((h) => h.name.toLowerCase() === "authorization");
    const value = header?.value || "";
    if (!/^bearer\s+/i.test(value)) return;
    saveToken(value.replace(/^bearer\s+/i, "").trim(), details.url).catch(console.error);
  },
  { urls: [`${API_ORIGIN}/api/*`] },
  ["requestHeaders", "extraHeaders"]
);

function userIdFromUrl(url) {
  const m = /\/api\/Users\/(\d+)\//i.exec(url);
  return m ? m[1] : null;
}

async function saveToken(token, url) {
  let claims;
  try { claims = decodeJwt(token); } catch { return; }
  const exp = Number(claims.exp);
  if (!exp || exp * 1000 <= Date.now()) return;

  const { auth } = await store.get("auth");
  if (auth?.token === token) return;

  const userId = String(claims.nameid ?? claims.id ?? userIdFromUrl(url) ?? auth?.userId ?? "");
  if (auth && auth.userId === userId && auth.exp > exp) return; // already have a newer session

  await store.set({
    auth: {
      token,
      userId,
      name: claims.displayName || claims.name || "",
      email: claims.email || "",
      exp,
      savedAt: Date.now(),
    },
    expiryWarnedOn: null,
  });
  await log(`Session updated for ${claims.email || `user ${userId}`}, valid until ${new Date(exp * 1000).toLocaleString()}`);

  // Anything that was waiting for a fresh session can run now.
  const day = await currentDay();
  let changed = false;
  for (const k of ["checkin", "checkout"]) {
    if (day[k].status === "blocked") { day[k] = { status: "pending", attempts: 0 }; changed = true; }
  }
  if (changed) await store.set({ day });
  tick();
}

// ───────────── Helpers ─────────────
async function log(msg, level = "info") {
  const { log: entries = [] } = await store.get("log");
  entries.unshift({ at: Date.now(), msg, level });
  await store.set({ log: entries.slice(0, 40) });
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener((id) => {
  chrome.tabs.create({ url: `${PORTAL_ORIGIN}/attendance` });
  chrome.notifications.clear(id);
});

async function apiFetch(auth, method, path, body) {
  try {
    const res = await fetch(API_ORIGIN + path, {
      method,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, text, json, url: API_ORIGIN + path, method };
  } catch (e) {
    return { ok: false, status: 0, text: String(e?.message || e), json: null };
  }
}

// Short human message from an API error: the JSON "Title" if present, else trimmed body text.
function errorTitle(r) {
  const j = r.json;
  const title = j && (j.Title ?? j.title ?? j.message ?? j.Message);
  return String(title || r.text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 200);
}

async function checkRemoteDay(auth, now) {
  if (!auth.userId) return { error: "User ID unknown. Open the portal's attendance page once." };
  const r = await apiFetch(auth, "GET", API.remoteWork.path(auth.userId, apiDate(now)));
  if (!r.ok) return { error: r.status ? `HTTP ${r.status}` : r.text };
  const j = r.json;
  const items = Array.isArray(j) ? j : (j?.data ?? j?.items ?? j?.result ?? []);
  const today = ymd(now);
  const isRemote = items.some((it) => {
    if (!it?.fromDate) return false;
    const from = ymd(new Date(it.fromDate));
    const to = it.toDate ? ymd(new Date(it.toDate)) : from;
    return from <= today && today <= to && API.remoteWork.isApproved(it);
  });
  return { isRemote };
}

const freshDay = (date) => ({
  date,
  checkin: { status: "pending", attempts: 0 },
  checkout: { status: "pending", attempts: 0 },
  remote: null,
});

// Today's record; on a new day, flags yesterday's missing check-out and starts fresh.
async function currentDay() {
  const today = ymd(new Date());
  const { day, settings } = await store.get(["day", "settings"]);
  if (day?.date === today) return day;
  if (day && settings?.enabled && day.checkin.status === "ok" && day.checkout.status !== "ok") {
    notify("Check-out missing", `No check-out was recorded on ${day.date}. Fix it in the portal.`);
    await log(`No check-out recorded on ${day.date}`, "warn");
  }
  const fresh = freshDay(today);
  await store.set({ day: fresh });
  return fresh;
}

// ───────────── Check-in / check-out ─────────────
async function perform(kind, auth, day, source) {
  const step = day[kind];
  const label = kind === "checkin" ? "Check-in" : "Check-out";
  step.attempts = (step.attempts || 0) + 1;
  await store.set({ day });

  const spec = kind === "checkin" ? API.checkIn : API.checkOut;
  const r = await apiFetch(auth, spec.method, spec.path(auth.userId), spec.body?.(auth.userId));
  const at = hhmm(new Date());
  console.log(`[${label}] ${r.method} ${r.url} body=${JSON.stringify(spec.body?.(auth.userId))} -> ${r.status}`, r.text.slice(0, 500));

  if (r.ok) {
    Object.assign(step, { status: "ok", at, note: source === "manual" ? "Run from the extension popup" : "" });
    notify(`${label} done`, `Recorded at ${at}.`);
    await log(`${label} done at ${at}${source === "manual" ? " (manual)" : ""}`);
  } else if (r.status === 401 || r.status === 403) {
    Object.assign(step, { status: "blocked", note: "The portal rejected the session. Sign in to the portal to renew it." });
    notify(`${label} not done`, step.note);
    await log(`${label}: HTTP ${r.status}, session rejected`, "error");
  } else {
    const note = r.status ? errorTitle(r) : `Network error: ${r.text}`;
    const retry = source === "auto" && (r.status === 0 || r.status >= 500) && step.attempts < MAX_ATTEMPTS;
    Object.assign(step, { status: retry ? "pending" : "failed", note });
    if (!retry) notify(`${label} failed`, note);
    await log(`${label} ${retry ? "attempt failed, retrying next minute" : "failed"}: ${note}`, retry ? "warn" : "error");
  }
  await store.set({ day });
  return step;
}

async function runTick() {
  const now = new Date();
  const today = ymd(now);
  const day = await currentDay();
  const got = await store.get(["settings", "auth", "expiryWarnedOn"]);
  const settings = { ...DEFAULT_SETTINGS, ...(got.settings || {}) };
  const auth = got.auth;

  if (!settings.enabled) return;

  // Session expiry warnings, at most once a day.
  if (auth?.exp && got.expiryWarnedOn !== today) {
    const left = auth.exp * 1000 - now.getTime();
    if (left <= 0) {
      notify("Session expired", "Sign in to the attendance portal so check-ins keep working.");
      await store.set({ expiryWarnedOn: today });
    } else if (left < EXPIRY_WARN_DAYS * 86400000) {
      const d = new Date(auth.exp * 1000).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      notify("Session expires soon", `Your portal session ends ${d}. Sign in to the portal to renew it.`);
      await store.set({ expiryWarnedOn: today });
    }
  }

  // Selected weekdays always run; other days run only if "also on remote-work days"
  // is on and there's a remote-work application for today.
  const weekdaySelected = settings.days.includes(now.getDay());
  if (!weekdaySelected && !settings.remoteDays) return;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const cin = minutesOf(settings.checkinTime);
  const cout = minutesOf(settings.checkoutTime);
  // Check-in window: check-in time until check-out time. Check-out window: until midnight.
  const kind = nowMin >= cout ? "checkout" : nowMin >= cin ? "checkin" : null;
  if (!kind) return;

  const step = day[kind];
  if (step.status !== "pending" || step.attempts >= MAX_ATTEMPTS) return;

  if (!auth?.token || auth.exp * 1000 <= now.getTime()) {
    if (!weekdaySelected) return; // can't look up remote work without a session; stay quiet
    Object.assign(step, { status: "blocked", note: "No valid session. Sign in to the portal." });
    await store.set({ day });
    notify(`${kind === "checkin" ? "Check-in" : "Check-out"} waiting`, "Sign in to the attendance portal and it will run right away.");
    await log(`${kind}: waiting for a portal sign-in`, "warn");
    return;
  }

  if (!weekdaySelected) {
    if (!day.remote || day.remote.error) {
      day.remote = await checkRemoteDay(auth, now);
      if (day.remote.error) {
        step.attempts += 1;
        if (step.attempts >= MAX_ATTEMPTS) {
          Object.assign(step, { status: "failed", note: `Couldn't check remote-work applications: ${day.remote.error}` });
          notify("Remote-work check failed", step.note);
        }
        await store.set({ day });
        await log(`Remote-work check failed: ${day.remote.error}`, "warn");
        return;
      }
      await store.set({ day });
      await log(day.remote.isRemote ? "Remote-work application found for today" : "No remote-work application for today");
    }
    if (!day.remote.isRemote) {
      Object.assign(step, { status: "skipped", note: "Not a selected day and no remote-work application" });
      await store.set({ day });
      return;
    }
  }

  await perform(kind, auth, day, "auto");
}

async function tick() {
  if (running) return;
  running = true;
  try { await runTick(); }
  catch (e) { await log(`Unexpected error: ${e?.message || e}`, "error"); }
  finally { running = false; }
}

async function runNow(kind) {
  if (running) return { ok: false, message: "A scheduled run is in progress. Try again in a moment." };
  running = true;
  try {
    const { auth } = await store.get("auth");
    if (!auth?.token) return { ok: false, message: "Not connected. Sign in to the portal first." };
    if (auth.exp * 1000 <= Date.now()) return { ok: false, message: "Session expired. Sign in to the portal to renew it." };
    const day = await currentDay();
    const step = await perform(kind, auth, day, "manual");
    return step.status === "ok" ? { ok: true } : { ok: false, message: step.note || "Request failed." };
  } finally {
    running = false;
  }
}

// Today's attendance record for the popup's time card.
async function getAttendanceToday() {
  const { auth } = await store.get("auth");
  if (!auth?.token || !auth.userId) return { ok: false, message: "Not connected." };
  const r = await apiFetch(auth, "GET", API.attendanceDay(auth.userId, apiDate(new Date())));
  if (!r.ok) return { ok: false, message: r.status ? errorTitle(r) : r.text };
  const j = r.json;
  const items = Array.isArray(j) ? j : (j?.data ?? j?.items ?? j?.result ?? (j ? [j] : []));
  const rec = items[0] || null;
  const pick = (k) => rec && Object.entries(rec).find(([key]) => key.toLowerCase() === k.toLowerCase())?.[1];
  return {
    ok: true,
    record: rec && {
      startTime: pick("startTime"),
      endTime: pick("endTime"),
      totalWorkingHour: pick("totalWorkingHour"),
      statusDisplayText: pick("statusDisplayText"),
    },
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "getAttendance") {
    getAttendanceToday().then(sendResponse);
    return true;
  }
  if (msg?.type === "runNow" && (msg.kind === "checkin" || msg.kind === "checkout")) {
    runNow(msg.kind).then(sendResponse);
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) tick();
});

// ───────────── Scheduling ─────────────
async function ensureAlarm() {
  const existing = await chrome.alarms.get("tick");
  if (!existing) await chrome.alarms.create("tick", { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === "tick") tick(); });
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); tick(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); tick(); });
ensureAlarm();
