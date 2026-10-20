import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Development: `npm run dev` on :5173, API calls go to the Builder API on :4000.
// Demo day: `npm run build`, and the Builder API serves web/dist itself on :4000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4000" },
  },
});
