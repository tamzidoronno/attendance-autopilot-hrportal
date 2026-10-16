// ─── Edit this file (and host_permissions in manifest.json) before installing ───

// Portal origin, no trailing slash. Must match host_permissions in manifest.json.
export const PORTAL_ORIGIN = "https://hrportal.cefalolab.com";

// API origin, no trailing slash. If the portal's frontend calls a different host
// (check DevTools > Network > Request URL), set it here AND in host_permissions.
export const API_ORIGIN = "https://hrportal.cefalolab.com";

export const API = {
  // TODO: copy the real method, path and body from DevTools (Network tab) when you
  // click check-in / check-out in the portal.
  checkIn: {
    method: "POST",
    path: (userId) => `/api/Users/${userId}/Attendances/WfhTimeLog`,
    body: (userId) => ({"action": 0}),
  },
  checkOut: {
    method: "POST",
    path: (userId) => `/api/Users/${userId}/Attendances/WfhTimeLog`,
    body: (userId) => ({"action": 1}),
  },

  // Today's attendance record: startTime, endTime, totalWorkingHour, statusDisplayText.
  // dates are formatted like 2026-Oct-16
  attendanceDay: (userId, date) => `/api/Users/${userId}/Attendances/${date}/${date}`,

  remoteWork: {
    // date is formatted like 2026-Oct-16
    path: (userId, date) =>
      `/api/Users/${userId}/RemoteWorkApplications?fromDate=${date}&toDate=${date}`,
    // TODO: if applications have a status field, only count approved ones,
    // e.g. (item) => item.status === "Approved"
    remoteWorkStatusDisplayName: (item) => "Approved",
  },
};

export const MAX_ATTEMPTS = 3;      // retries for network errors / 5xx
export const EXPIRY_WARN_DAYS = 3;  // warn this many days before the session expires
