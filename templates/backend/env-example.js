// .env.example of the generated app. Login settings appear only when a login screen was shown (Step 12).
export default ({ app, spec }) => `# Copy to .env and adjust.
MONGODB_URI=mongodb://127.0.0.1:27017/${app.dbName}
PORT=3000
${
  spec.auth
    ? `
# A screenshot shows a login form. The first account is created from these when there are no accounts yet.
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-please
# How long a login lasts.
SESSION_HOURS=12
`
    : ""
}`;
