// App Specs shared by the generator tests (unit and integration). Shapes match src/spec/derive.js output.
const ev = (what) => `s1: ${what}`;

// Edit/Delete only: list, get, update, delete (hard).
export const editDeleteSpec = {
  entities: [
    {
      name: "employee",
      plural: "employees",
      label: "Employees",
      sampleConst: "SAMPLE_EMPLOYEES",
      fields: [
        { name: "fullName", label: "Full Name", type: "string", required: true, evidence: ev("column 'Full Name'") },
        { name: "email", label: "Email", type: "email", required: true, evidence: ev("column 'Email'") },
        { name: "salary", label: "Salary", type: "number", required: false, evidence: ev("column 'Salary'") },
      ],
      endpoints: {
        list: { search: false, filters: [], pagination: false, evidence: ev("table 'Employees'") },
        get: { evidence: ev("row action 'Edit' (loads the record)") },
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

// Add + search + filter + pagination, no edit/delete.
export const catalogSpec = {
  entities: [
    {
      name: "product",
      plural: "products",
      label: "Products",
      sampleConst: "SAMPLE_PRODUCTS",
      fields: [
        { name: "name", label: "Name", type: "string", required: true, evidence: ev("column 'Name'") },
        { name: "category", label: "Category", type: "enum", options: ["Stationery", "Electronics"], required: false, evidence: ev("column 'Category'") },
        { name: "price", label: "Price", type: "number", required: false, evidence: ev("column 'Price'") },
        { name: "inStock", label: "In Stock", type: "boolean", required: false, evidence: ev("column 'In Stock'") },
      ],
      endpoints: {
        list: { search: true, filters: ["category"], pagination: true, evidence: ev("table 'Products'") },
        create: { evidence: ev("button '+ Add Product'") },
      },
    },
  ],
  operations: [],
  stats: [],
  auth: null,
  pages: [{ screenshot: 1, kind: "list", entity: "product" }],
  openQuestions: [],
};

// Two related pages; leave requests are soft-deleted (an Archive control is visible).
export const relationSpec = {
  entities: [
    {
      name: "leaveRequest",
      plural: "leaveRequests",
      label: "Leave Requests",
      sampleConst: "SAMPLE_LEAVEREQUESTS",
      fields: [
        { name: "employeeName", label: "Employee", type: "string", required: true, evidence: ev("column 'Employee'") },
        { name: "department", label: "Department", type: "ref", ref: "department", required: true, evidence: `${ev("column 'Department'")}; s2: table 'Departments'` },
        { name: "from", label: "From", type: "date", required: true, evidence: ev("column 'From'") },
      ],
      endpoints: {
        list: { search: false, filters: [], pagination: false, evidence: ev("table 'Leave Requests'") },
        create: { evidence: ev("button 'Add Request'") },
        get: { evidence: ev("row action 'View'") },
        delete: { soft: true, evidence: `${ev("row action 'Delete'")}; ${ev("button 'Show Archived'")}` },
      },
    },
    {
      name: "department",
      plural: "departments",
      label: "Departments",
      sampleConst: "SAMPLE_DEPARTMENTS",
      fields: [{ name: "name", label: "Name", type: "string", required: true, evidence: "s2: column 'Name'" }],
      endpoints: { list: { search: false, filters: [], pagination: false, evidence: "s2: table 'Departments'" } },
    },
  ],
  operations: [],
  stats: [],
  auth: null,
  pages: [
    { screenshot: 1, kind: "list", entity: "leaveRequest" },
    { screenshot: 2, kind: "list", entity: "department" },
  ],
  openQuestions: [],
};
