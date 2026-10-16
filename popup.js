import { PORTAL_ORIGIN } from "./config.js";
import { DEFAULT_SETTINGS, ymd, minutesOf } from "./shared.js";

const $ = (id) => document.getElementById(id);
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let state = { settings: { ...DEFAULT_SETTINGS } };

async function load() {
  const got = await chrome.storage.local.get(["settings", "auth", "day", "log"]);
  state = { ...got, settings: { ...DEFAULT_SETTINGS, ...(got.settings || {}) } };
  render();
}

function openPortal() {
  chrome.tabs.create({ url: `${PORTAL_ORIGIN}/attendance` });
}

function renderSession(auth, now) {
  const el = $("session");
  el.className = "session";
  el.replaceChildren();
  const msg = document.createElement("span");
  let tone = null;

  if (!auth?.token) {
    msg.textContent = "Sign in to the portal once and the extension picks up your session.";
    tone = "warn";
  } else {
    const end = new Date(auth.exp * 1000);
    const when = end.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const left = end - now;
    if (left <= 0) {
      msg.textContent = `Session expired on ${when}. Sign in to the portal to renew it.`;
      tone = "bad";
    } else {
      const days = Math.floor(left / 86400000);
      msg.textContent = days < 1
        ? `Session ends today at ${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`
        : `Session valid until ${when}, ${days} day${days === 1 ? "" : "s"} left.`;
      if (days < 3) tone = "warn";
    }
  }
  el.append(msg);
  if (tone) {
    el.classList.add(tone);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Open portal";
    btn.onclick = openPortal;
    el.append(btn);
  }
}

// "2026-10-16T09:02:00" -> "09:02"; anything else is shown as the API sent it.
function clock(v) {
  if (v == null || v === "") return "–";
  const m = /T(\d{2}:\d{2})/.exec(String(v));
  return m ? m[1] : String(v);
}

function renderAttendance(res) {
  const rec = res?.record;
  $("in-time").textContent = clock(rec?.startTime);
  $("out-time").textContent = clock(rec?.endTime);
  $("att-total").textContent = rec?.totalWorkingHour ?? "–";
  const st = $("att-status");
  st.textContent = res && !res.ok ? res.message : rec ? (rec.statusDisplayText ?? "") : "No attendance recorded yet";
  st.className = res && !res.ok ? "bad" : "muted";
}

async function loadAttendance() {
  let res;
  try { res = await chrome.runtime.sendMessage({ type: "getAttendance" }); }
  catch (e) { res = { ok: false, message: String(e?.message || e) }; }
  renderAttendance(res);
}

function render() {
  const { settings, auth, day, log = [] } = state;
  const now = new Date();

  $("who").textContent = auth?.userId
    ? `${auth.name || auth.email}, user ${auth.userId}`
    : "Not connected yet";
  renderSession(auth, now);

  $("enabled").checked = settings.enabled;
  if (document.activeElement !== $("checkinTime")) $("checkinTime").value = settings.checkinTime;
  if (document.activeElement !== $("checkoutTime")) $("checkoutTime").value = settings.checkoutTime;
  $("remoteDays").checked = settings.remoteDays;

  $("days").replaceChildren(...DAY_LABELS.map((label, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(settings.days.includes(i)));
    b.onclick = () => {
      const days = settings.days.includes(i)
        ? settings.days.filter((d) => d !== i)
        : [...settings.days, i].sort((a, b) => a - b);
      saveSettings({ days });
    };
    return b;
  }));

  $("today-h").textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  $("log").replaceChildren(...(log.length ? log : [{ at: null, msg: "Nothing yet." }]).map((e) => {
    const li = document.createElement("li");
    li.className = e.level || "";
    const t = document.createElement("time");
    if (e.at) {
      const d = new Date(e.at);
      t.textContent = d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    }
    const s = document.createElement("span");
    s.textContent = e.msg;
    li.append(t, s);
    return li;
  }));
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.hidden = !msg;
}

async function saveSettings(patch) {
  const next = { ...state.settings, ...patch };
  if (!next.checkinTime || !next.checkoutTime) return;
  if (minutesOf(next.checkoutTime) <= minutesOf(next.checkinTime)) {
    showError("Check-out time has to be later than check-in time.");
    render();
    return;
  }
  showError("");
  await chrome.storage.local.set({ settings: next });
}

function setupAction(btn, kind, idleText, confirmText) {
  let armed = false;
  let timer;
  const reset = () => {
    armed = false;
    btn.textContent = idleText;
    btn.classList.remove("armed");
  };
  btn.onclick = async () => {
    if (!armed) {
      armed = true;
      btn.textContent = confirmText;
      btn.classList.add("armed");
      timer = setTimeout(reset, 4000);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    btn.textContent = "Sending…";
    const res = await chrome.runtime.sendMessage({ type: "runNow", kind });
    btn.disabled = false;
    reset();
    showError(res?.ok ? "" : (res?.message || "Request failed."));
    loadAttendance();
  };
}

$("enabled").addEventListener("change", (e) => saveSettings({ enabled: e.target.checked }));
$("remoteDays").addEventListener("change", (e) => saveSettings({ remoteDays: e.target.checked }));
$("checkinTime").addEventListener("change", (e) => saveSettings({ checkinTime: e.target.value }));
$("checkoutTime").addEventListener("change", (e) => saveSettings({ checkoutTime: e.target.value }));
setupAction($("btn-in"), "checkin", "Check in now", "Confirm check-in");
setupAction($("btn-out"), "checkout", "Check out now", "Confirm check-out");

chrome.storage.onChanged.addListener((_c, area) => { if (area === "local") load(); });
load();
loadAttendance();
