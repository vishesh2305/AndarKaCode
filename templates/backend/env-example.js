// .env.example of the generated app. Login settings appear only when a login screen was shown (Step 12).
export default ({ app }) => `# Copy to .env and adjust.
MONGODB_URI=mongodb://127.0.0.1:27017/${app.dbName}
PORT=3000
`;
