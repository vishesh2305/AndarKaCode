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

// Row buttons beyond edit/delete, an Export button, and stat cards (a "Leave Requests" dashboard).
export const opsSpec = {
  entities: [
    {
      name: "leaveRequest",
      plural: "leaveRequests",
      label: "Leave Requests",
      sampleConst: "SAMPLE_LEAVEREQUESTS",
      fields: [
        { name: "employee", label: "Employee", type: "string", required: true, evidence: ev("column 'Employee'") },
        { name: "days", label: "Days", type: "number", required: false, evidence: ev("column 'Days'") },
        { name: "status", label: "Status", type: "enum", options: ["Pending", "Approved", "Rejected"], required: false, evidence: ev("column 'Status'") },
      ],
      endpoints: { list: { search: false, filters: [], pagination: false, evidence: ev("table 'Leave Requests'") } },
    },
  ],
  operations: [
    { name: "approveLeaveRequest", entity: "leaveRequest", kind: "setStatus", set: { status: "Approved" }, button: "Approve", evidence: ev("row action 'Approve'") },
    { name: "rejectLeaveRequest", entity: "leaveRequest", kind: "setStatus", set: { status: "Rejected" }, button: "Reject", evidence: ev("row action 'Reject'") },
    { name: "exportLeaveRequests", entity: "leaveRequest", kind: "export", button: "Export CSV", evidence: ev("button 'Export CSV'") },
    { name: "recalculateLeaveRequest", entity: "leaveRequest", kind: "custom", scope: "row", button: "Recalculate", evidence: ev("row action 'Recalculate'") },
    { name: "syncPayrollLeaveRequest", entity: "leaveRequest", kind: "custom", scope: "page", button: "Sync Payroll", evidence: ev("button 'Sync Payroll'") },
  ],
  stats: [
    { label: "Total Requests", entity: "leaveRequest", metric: "count", evidence: ev("stat card 'Total Requests'") },
    { label: "Pending", entity: "leaveRequest", metric: "count", where: { status: "Pending" }, evidence: ev("stat card 'Pending'") },
    { label: "Total Days", entity: "leaveRequest", metric: "sum", field: "days", evidence: ev("stat card 'Total Days'") },
    { label: "Happiness Index", entity: "leaveRequest", metric: "custom", evidence: ev("stat card 'Happiness Index'") },
  ],
  auth: null,
  pages: [{ screenshot: 1, kind: "dashboard", entity: "leaveRequest" }],
  openQuestions: [],
};
