// Step 20: log lines. Plain text while developing; one JSON object per line in production
// (LOG_FORMAT=json), so the server's log collector can search them by project, level and time.
const FORMAT = process.env.LOG_FORMAT === "json" ? "json" : "text";

/** One log entry { level, msg, project?, ...fields } as one line. */
export function logLine(entry, format = FORMAT) {
  if (format === "json") return JSON.stringify(entry);
  return entry.project ? `[${entry.project}] ${entry.msg}` : entry.msg;
}

const write = (level, msg, fields) => {
  const line = logLine({ time: new Date().toISOString(), level, msg, ...fields });
  (level === "error" ? console.error : console.log)(line);
};

export const log = {
  info: (msg, fields = {}) => write("info", msg, fields),
  error: (msg, fields = {}) => write("error", msg, fields),
};
