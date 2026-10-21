// App Specs matching the pages in fixtures/pages (binder tests). Shapes match src/spec/derive.js output.
import { catalogSpec, opsSpec } from "./specs.js";
export { authSpec, editDeleteSpec as staffSpec, relationSpec } from "./specs.js";

const ev = (what) => `s1: ${what}`;

// employees-real.html: the real Laptop B page (Add form, search box, Edit/Delete rows).
export const employeesSpec = {
  entities: [
    {
      name: "employee",
      plural: "employees",
      label: "Employees",
      sampleConst: "SAMPLE_EMPLOYEES",
      fields: [
        { name: "fullName", label: "Full Name", type: "string", required: true, evidence: ev("column 'Full Name'") },
        { name: "email", label: "Email", type: "email", required: true, evidence: ev("column 'Email'") },
        { name: "department", label: "Department", type: "enum", options: ["HR", "Engineering", "Sales"], required: false, evidence: ev("column 'Department'") },
        { name: "salary", label: "Salary", type: "number", required: false, evidence: ev("column 'Salary'") },
      ],
      endpoints: {
        list: { search: true, filters: [], pagination: false, evidence: ev("table 'Employees'") },
        create: { evidence: ev("button 'Add Employee'") },
        get: { evidence: ev("row action 'Edit'") },
        update: { evidence: ev("row action 'Edit'") },
        delete: { soft: false, evidence: ev("row action 'Delete'") },
      },
    },
  ],
  operations: [],
  stats: [],
  auth: null,
  pages: [{ screenshot: 1, kind: "list", entity: "employee" }],
  openQuestions: [],
};

// leave-dashboard.html: opsSpec with a status filter and previous/next page.
export const dashboardSpec = {
  ...opsSpec,
  entities: opsSpec.entities.map((e) => ({
    ...e,
    endpoints: { list: { ...e.endpoints.list, filters: ["status"], pagination: true } },
  })),
};

// products-cards.html: catalogSpec as it is (search, category filter, pages, Add).
export const productsSpec = catalogSpec;
