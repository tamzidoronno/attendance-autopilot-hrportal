export const DEFAULT_SETTINGS = {
  enabled: false,
  checkinTime: "09:00",
  checkoutTime: "18:00",
  days: [3, 4], // 0 = Sunday … 6 = Saturday
  remoteDays: false, // also run on days with a remote-work application
};

export function decodeJwt(token) {
  const part = token.split(".")[1];
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const pad2 = (n) => String(n).padStart(2, "0");

// Local date as YYYY-MM-DD
export function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Date format the remote-work API expects: 2026-Oct-16
export function apiDate(d) {
  return `${d.getFullYear()}-${MONTHS[d.getMonth()]}-${pad2(d.getDate())}`;
}

export function minutesOf(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

export function hhmm(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
