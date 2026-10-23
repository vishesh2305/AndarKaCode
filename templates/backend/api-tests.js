// tests/api.test.js of the generated app: one test per endpoint and button the screenshots show.
// The generated code uses only plain strings (no template literals, no regex) to keep it easy to read.
const q = JSON.stringify;

// Same escaping as the generated Export: quote values with comma, quote or line break.
const csvHeader = (labels) => labels.map((l) => (/[",\r\n]/.test(l) ? `"${l.replace(/"/g, '""')}"` : l)).join(",");

function sampleValue(f, pascal) {
  switch (f.type) {
    case "string":
      return `${q(`Sample ${f.label} `)} + n`;
    case "email":
      return '"sample" + n + "@example.com"';
    case "number":
      return "n";
    case "boolean":
      return "true";
    case "date":
      return '"2026-01-15"';
    case "enum":
      return q(f.options[0]);
    case "ref":
      return `(await create${pascal(f.ref)}()).id`;
  }
}

// A different valid value for an update, and how to compare what comes back.
function updatedValue(f) {
  switch (f.type) {
    case "string":
      return { send: '"Updated value"', expect: '"Updated value"' };
    case "email":
      return { send: '"updated@example.com"', expect: '"updated@example.com"' };
    case "number":
      return { send: "999", expect: "999" };
    case "boolean":
      return { send: "false", expect: "false" };
    case "date":
      return { send: '"2026-02-01"', expect: '"2026-02-01"', date: true };
    case "enum":
      return { send: q(f.options.at(-1)), expect: q(f.options.at(-1)) };
    default:
      return null;
  }
}

function entityTests(entity, pascal, comment) {
  const M = entity.Model;
  const api = `/api/${entity.plural}`;
  const create = `create${M}`;
  const { endpoints } = entity;
  const tests = [];
  const it = (name, evidence, body) => `  it(${q(`${name} (${comment(evidence)})`)}, async () => {\n${body}\n  });`;
  const textField = entity.fields.find((f) => f.type === "string" || f.type === "email");

  if (endpoints.list) {
    tests.push(
      it("lists records", endpoints.list.evidence, `    const record = await ${create}();
    const res = await call("GET", ${q(api)});
    assert.equal(res.status, 200);
    assert.ok(res.body.items.some((item) => item.id === record.id));
    assert.ok(res.body.total >= 1);`)
    );

    if (endpoints.list.search && textField) {
      const needleValue = textField.type === "email" ? 'needle + "@example.com"' : '"Item " + needle';
      tests.push(
        it("searches by text", endpoints.list.evidence, `    const needle = "needle" + (++counter);
    const match = await ${create}({ ${textField.name}: ${needleValue} });
    const other = await ${create}();
    const res = await call("GET", ${q(`${api}?q=`)} + needle);
    assert.equal(res.status, 200);
    assert.ok(res.body.items.some((item) => item.id === match.id));
    assert.ok(!res.body.items.some((item) => item.id === other.id));`)
      );
    }

    for (const name of endpoints.list.filters) {
      const f = entity.fields.find((x) => x.name === name);
      const pair =
        f?.type === "enum" && f.options.length >= 2 ? [q(f.options[0]), q(f.options[1])] : f?.type === "boolean" ? ["true", "false"] : null;
      tests.push(
        it(
          `filters by ${name}`,
          endpoints.list.evidence,
          pair
            ? `    const kept = await ${create}({ ${name}: ${pair[1]} });
    const dropped = await ${create}({ ${name}: ${pair[0]} });
    const res = await call("GET", ${q(`${api}?${name}=`)} + encodeURIComponent(${pair[1]}));
    assert.equal(res.status, 200);
    assert.ok(res.body.items.some((item) => item.id === kept.id));
    assert.ok(!res.body.items.some((item) => item.id === dropped.id));`
            : `    const res = await call("GET", ${q(`${api}?${name}=`)});
    assert.equal(res.status, 200);`
        )
      );
    }

    if (endpoints.list.pagination) {
      tests.push(
        it("pages results", endpoints.list.evidence, `    for (let i = 0; i < 3; i++) await ${create}();
    const res = await call("GET", ${q(`${api}?page=1&limit=2`)});
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 2);
    assert.ok(res.body.total >= 3);
    assert.equal(res.body.page, 1);`)
      );
    }
  }

  if (endpoints.get) {
    tests.push(
      it("gets one record, and 404 for an unknown id", endpoints.get.evidence, `    const record = await ${create}();
    const res = await call("GET", ${q(`${api}/`)} + record.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, record.id);
    assert.equal((await call("GET", ${q(`${api}/`)} + missingId())).status, 404);`)
    );
  }

  if (endpoints.create) {
    const required = entity.fields.filter((f) => f.required).map((f) => f.name).sort();
    tests.push(
      it("creates a record, and refuses missing required fields", endpoints.create.evidence, `    const res = await call("POST", ${q(api)}, await sample${M}());
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.id, "string");${
      required.length
        ? `
    const empty = await call("POST", ${q(api)}, {});
    assert.equal(empty.status, 400);
    assert.deepEqual(Object.keys(empty.body.details).sort(), ${q(required)});`
        : ""
    }`)
    );
  }

  if (endpoints.update) {
    const f = entity.fields.find((x) => updatedValue(x));
    const v = f && updatedValue(f);
    const invalid = entity.fields.find((x) => x.type === "number" || x.type === "email");
    const check = v?.date
      ? `    assert.equal(new Date(res.body.${f.name}).toISOString().slice(0, 10), ${v.expect});`
      : v && `    assert.equal(res.body.${f.name}, ${v.expect});`;
    tests.push(
      it("updates a record, and refuses invalid values", endpoints.update.evidence, `    const record = await ${create}();
    const res = await call("PUT", ${q(`${api}/`)} + record.id, ${v ? `{ ${f.name}: ${v.send} }` : "{}"});
    assert.equal(res.status, 200);
${check ?? ""}${
      invalid
        ? `
    const bad = await call("PUT", ${q(`${api}/`)} + record.id, { ${invalid.name}: "not valid" });
    assert.equal(bad.status, 400);`
        : ""
    }
    assert.equal((await call("PUT", ${q(`${api}/`)} + missingId(), {})).status, 404);`)
    );
  }

  if (endpoints.delete) {
    const gone = endpoints.get
      ? `    assert.equal((await call("GET", ${q(`${api}/`)} + record.id)).status, 404);`
      : `    assert.ok(!(await call("GET", ${q(api)})).body.items.some((item) => item.id === record.id));`;
    tests.push(
      it("deletes a record", endpoints.delete.evidence, `    const record = await ${create}();
    assert.equal((await call("DELETE", ${q(`${api}/`)} + record.id)).status, 204);
${endpoints.get || endpoints.list ? gone : ""}
    assert.equal((await call("DELETE", ${q(`${api}/`)} + missingId())).status, 404);`)
    );
  }

  for (const op of entity.operations) {
    const url = op.route.row
      ? `${q(`${api}/`)} + record.id + ${q(op.route.path.replace("/:id", ""))}`
      : q(`${api}${op.route.path}`);
    const setup = op.route.row ? `    const record = await ${create}();\n` : `    await ${create}();\n`;
    if (op.kind === "setStatus") {
      const [field, value] = Object.entries(op.set)[0];
      tests.push(
        it(`${op.button} sets ${field} to ${value}`, op.evidence, `${setup}    const res = await call("POST", ${url});
    assert.equal(res.status, 200);
    assert.equal(res.body.${field}, ${q(value)});`)
      );
    } else if (op.kind === "export") {
      tests.push(
        it(`${op.button} downloads a CSV`, op.evidence, `${setup}    const res = await call("GET", ${url});
    assert.equal(res.status, 200);
    assert.ok(res.type.includes("text/csv"));
    assert.equal(res.text.split("\\n")[0], ${q(csvHeader(entity.fields.map((x) => x.label)))});`)
      );
    } else if (op.written) {
      // Written by the AI layer (Step 13): it answers, or refuses with a message; an error in it would be 500.
      tests.push(
        it(`${op.button} answers (its code is in backend/custom/${op.name}.js)`, op.evidence, `${setup}    const res = await call("POST", ${url}, {});
    assert.ok([200, 400].includes(res.status), JSON.stringify(res.body));`)
      );
    } else {
      tests.push(
        it(`${op.button} answers 501 until it is written`, op.evidence, `${setup}    const res = await call("POST", ${url});
    assert.equal(res.status, 501);`)
      );
    }
  }

  return `describe(${q(entity.label)}, () => {\n${tests.join("\n\n")}\n});`;
}

function sampleFunctions(entity, pascal) {
  const values = entity.fields
    .filter((f) => f.type !== "ref" || f.required) // optional relations are left out (avoids loops between entities)
    .map((f) => `    ${f.name}: ${sampleValue(f, pascal)},`);
  return `// A valid ${entity.Model} (related records are created first). Each call gives new values.
async function sample${entity.Model}() {
  const n = ++counter;
  return {
${values.join("\n")}
  };
}
async function create${entity.Model}(overrides = {}) {
  return ${entity.Model}.create({ ...(await sample${entity.Model}()), ...overrides });
}`;
}

// Only when a login screen is shown: the login rules, plus sign-up / me / logout when those are shown.
function authTests(spec, comment) {
  const { auth } = spec;
  const it = (name, evidence, body) => `  it(${q(`${name} (${comment(evidence)})`)}, async () => {\n${body}\n  });`;
  const protectedRoute = `/api/${spec.entities[0]?.plural ?? (spec.stats.length ? "stats" : "nothing-here")}`;
  const tests = [
    it("logs in with the right password", auth.login.evidence, `    const res = await call("POST", "/api/auth/login", { email: TESTER.email, password: TESTER.password }, { login: false });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.token, "string");
    assert.equal(res.body.user.passwordHash, undefined);`),
    it("refuses a wrong password", auth.login.evidence, `    const res = await call("POST", "/api/auth/login", { email: TESTER.email, password: "wrong-password" }, { login: false });
    assert.equal(res.status, 401);`),
    it("pauses login after 5 wrong passwords", auth.login.evidence, `    await Account.create({ email: "locked@example.com", passwordHash: await hashPassword("locked-pass-123") });
    for (let i = 0; i < 5; i++) {
      assert.equal((await call("POST", "/api/auth/login", { email: "locked@example.com", password: "guess" + i }, { login: false })).status, 401);
    }
    const res = await call("POST", "/api/auth/login", { email: "locked@example.com", password: "locked-pass-123" }, { login: false });
    assert.equal(res.status, 429);`),
    it("refuses data without a login", auth.login.evidence, `    assert.equal((await call("GET", ${q(protectedRoute)}, null, { login: false })).status, 401);`),
  ];
  if (auth.signup) {
    tests.push(
      it("registers a new account", auth.signup.evidence, `    const res = await call("POST", "/api/auth/register", { email: "new" + (++counter) + "@example.com", password: "new-pass-123" }, { login: false });
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.token, "string");`)
    );
  }
  if (auth.me) {
    tests.push(
      it("returns the logged-in user", auth.me.evidence, `    const res = await call("GET", "/api/auth/me");
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, TESTER.email);`),
      it("logs out", auth.me.evidence, `    const own = (await call("POST", "/api/auth/login", { email: TESTER.email, password: TESTER.password }, { login: false })).body.token;
    assert.equal((await call("POST", "/api/auth/logout", null, { token: own })).status, 204);
    assert.equal((await call("GET", "/api/auth/me", null, { token: own })).status, 401);`)
    );
  }
  return `describe("Login", () => {\n${tests.join("\n\n")}\n});`;
}

function statsTests(spec, camelCase, comment) {
  const keys = spec.stats.map((s) => camelCase(s.label));
  const checks = spec.stats.map((s) =>
    s.metric === "custom"
      ? `    assert.equal(res.body.${camelCase(s.label)}, null);`
      : `    assert.equal(typeof res.body.${camelCase(s.label)}, "number");`
  );
  return `describe("Stat cards", () => {
  it(${q(`stat cards return exactly the visible numbers (${spec.stats.map((s) => comment(s.evidence)).join("; ")})`)}, async () => {
    const res = await call("GET", "/api/stats");
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ${q([...keys].sort())});
${checks.join("\n")}
  });
});`;
}

export default ({ app, spec, entities, pascal, camelCase, comment }) => `// API tests generated by AndarKaCode: one test per endpoint and button the screenshots show.
// Run: MONGODB_URI_TEST=mongodb://127.0.0.1:27017/${app.dbName}_test npm test   (that database is emptied)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { app } from "../backend/server.js";
${entities.map((e) => `import { ${e.Model} } from "../backend/models/${e.name}.model.js";`).join("\n")}${
  spec.auth
    ? `\nimport { hashPassword } from "../backend/auth/passwords.js";\nimport { Account } from "../backend/models/account.model.js";`
    : ""
}

const MONGODB_URI_TEST = process.env.MONGODB_URI_TEST ?? "mongodb://127.0.0.1:27017/${app.dbName}_test";
let server;
let base;
let counter = 0;
${spec.auth ? 'let token; // the test account\'s login, sent with every request\nconst TESTER = { email: "tester@example.com", password: "tester-pass-123" };\n' : ""}
before(async () => {
  await mongoose.connect(MONGODB_URI_TEST);
  await mongoose.connection.dropDatabase();
  server = app.listen(0);
  base = "http://127.0.0.1:" + server.address().port;${
    spec.auth
      ? `
  // A screenshot shows a login form, so every data request needs a login.
  await Account.create({ email: TESTER.email, passwordHash: await hashPassword(TESTER.password)${
    spec.auth.roles ? `, role: ${q(spec.auth.roles.values[0])}` : ""
  } });
  token = (await call("POST", "/api/auth/login", TESTER, { login: false })).body.token;`
      : ""
  }
});

// Close only what was opened, so a failed start can't make the cleanup hang.
after(async () => {
  server?.close();
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

${
  spec.auth
    ? `// Sends the test account's login unless { login: false }; { token } sends a specific one.
async function call(method, route, body, { login = true, token: own } = {}) {
  const headers = body ? { "Content-Type": "application/json" } : {};
  const bearer = own ?? (login ? token : undefined);
  if (bearer) headers.Authorization = "Bearer " + bearer;
  const res = await fetch(base + route, { method, headers, body: body ? JSON.stringify(body) : undefined });`
    : `async function call(method, route, body) {
  const res = await fetch(base + route, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body && JSON.stringify(body),
  });`
}
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text, type: res.headers.get("content-type") ?? "" };
}

const missingId = () => new mongoose.Types.ObjectId().toString();

${entities.map((e) => sampleFunctions(e, pascal)).join("\n\n")}

// Every app has at least this test, even one whose screenshots show only a login screen.
describe("Server", () => {
  it("answers GET /health", async () => {
    const res = await call("GET", "/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });
});

${spec.auth ? `${authTests(spec, comment)}\n\n` : ""}${entities.map((e) => entityTests(e, pascal, comment)).join("\n\n")}
${spec.stats.length ? `\n${statsTests(spec, camelCase, comment)}\n` : ""}`;
