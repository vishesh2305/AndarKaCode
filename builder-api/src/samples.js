// Evaluation plan B1: "Try a sample". Ready screenshots from samples/mocks, picked with one click on the upload
// screen. Files are found by the sample's id and page number only, never by a path from the request.
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOCKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "samples", "mocks");

export const SAMPLES = [
  { id: "techfest", name: "TechFest Registrations", about: "Student registrations: search, an event filter, number cards and a Check In button", files: ["m9-event-registrations.png"] },
  { id: "employees", name: "Employees", about: "A “Give 10% Raise” button whose code the coding AI writes and tests", files: ["m7-custom-buttons.png"] },
  { id: "orders", name: "Orders Dashboard", about: "Number cards worked out from the orders table", files: ["m3-dashboard.png"] },
  { id: "departments", name: "Staff & Departments", about: "Two pages: employees linked to their department", files: ["m5a-employees-dept.png", "m5b-departments.png"] },
];

/** What GET /api/samples answers: no file names, only where to fetch each page. */
export const sampleList = () =>
  SAMPLES.map(({ id, name, about, files }) => ({ id, name, about, images: files.map((_, i) => `/api/samples/${id}/${i + 1}.png`) }));

/** The file of a sample's page (1-based), or null. */
export function sampleFile(id, page) {
  const sample = SAMPLES.find((s) => s.id === id);
  const n = Number(page);
  if (!sample || !Number.isInteger(n) || n < 1 || n > sample.files.length) return null;
  return path.join(MOCKS, sample.files[n - 1]);
}
