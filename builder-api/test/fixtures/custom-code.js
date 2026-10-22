// Hand-written custom button functions in the fixed shape (Step 13): good ones for the safety check and
// the runtime, and the model test's reference answers. Shape: export default async function ({ record, input, helpers }).
export const GOOD = {
  raise: `export default async function ({ record, helpers }) {
  const salary = Math.round(record.salary * 1.1);
  await helpers.update(record.id, { salary });
  return { message: \`Salary raised to \${salary}\` };
}`,
  duplicate: `export default async function ({ record, helpers }) {
  const { id, createdAt, updatedAt, ...rest } = record;
  const copy = await helpers.create({ ...rest, name: record.name + " (copy)" });
  return { message: "Copied", record: copy };
}`,
  markAllPaid: `export default async function ({ helpers }) {
  const changed = await helpers.updateMany({ status: "Unpaid" }, { status: "Paid" });
  return { message: \`\${changed} invoices marked paid\` };
}`,
  recalculateDays: `export default async function ({ record, helpers }) {
  const days = Math.round((new Date(record.to) - new Date(record.from)) / 86400000) + 1;
  await helpers.update(record.id, { days });
  return { message: \`\${days} days\` };
}`,
  restock: `export default async function ({ helpers }) {
  const empty = await helpers.list({ inStock: false });
  for (const product of empty) await helpers.update(product.id, { inStock: true });
  return { message: \`\${empty.length} restocked\` };
}`,
  refuse: `export default async function ({ record, helpers }) {
  if (record.status === "Approved") helpers.fail("Approved requests can't be recalculated");
  return { message: "ok" };
}`,
};
