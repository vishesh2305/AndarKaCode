// Calls to the Builder API (same origin in production; proxied by Vite in development).
async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const api = {
  health: () => fetch("/api/health").then(json),
  projects: () => fetch("/api/projects").then(json),
  project: (id) => fetch(`/api/projects/${id}`).then(json),
  files: (id) => fetch(`/api/projects/${id}/files`).then(json),
  fileContent: (id, path) =>
    fetch(`/api/projects/${id}/files/content?path=${encodeURIComponent(path)}`).then(async (res) => {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      return res.text();
    }),
  create: (files, { name, mode }) => {
    const form = new FormData();
    for (const file of files) form.append("image", file, file.name);
    if (name) form.append("name", name);
    form.append("mode", mode);
    return fetch("/api/projects", { method: "POST", body: form }).then(json);
  },
  screenshotUrl: (id, n) => `/api/projects/${id}/screenshots/${n}`,
  pageUrl: (id, n) => `/api/projects/${id}/frontend?page=${n}`,
  downloadUrl: (id, { anyway = false } = {}) => `/api/projects/${id}/download${anyway ? "?anyway=1" : ""}`,
  // The live preview: { url (on its own local port), credentials (only for apps with a login screen) }.
  startPreview: (id) => fetch(`/api/projects/${id}/preview`, { method: "POST" }).then(json),
  stopPreview: (id) => fetch(`/api/projects/${id}/preview`, { method: "DELETE" }),
};
