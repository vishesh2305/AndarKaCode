// backend/custom/run.js and backend/custom/worker.js of a generated app (only when a screenshot shows a
// button no template covers): run that button's code, written by AndarKaCode's AI layer (Step 13).

export const runFile = () => String.raw`// Runs a custom button's code (backend/custom/<button>.js, written by AndarKaCode's AI layer and
// checked before it was saved). Each press runs in a worker thread of its own (worker.js):
//   - the code sees only its helpers, for its own table, with the same checks as Add and Edit;
//   - only plain data (text) goes between the worker and this server;
//   - if the code goes quiet for 2 s without asking a helper (a stuck loop), or the press takes more
//     than 30 s, the worker is stopped; the server keeps answering.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIET_MS = 2000; // the code may compute this long between helper calls
const TOTAL_MS = 30000; // the whole button
const LIST_CAP = 500;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

class Refused extends Error {} // the button says no (400), as opposed to a mistake in the code (500)

const plain = (doc) => (doc ? JSON.parse(JSON.stringify(doc)) : null);

// The helpers' database work, here in the server: only the table's own fields, through its validation.
function tableHelpers(Model, validate) {
  const alive = Model.schema.path("deletedAt") ? { deletedAt: null } : {};
  const check = (values, partial) => {
    const { errors, value } = validate(values ?? {}, { partial });
    const problems = Object.entries(errors);
    if (problems.length) throw new Refused(problems.map(([field, message]) => field + ": " + message).join("; "));
    return value;
  };
  const byId = (id) => {
    if (!OBJECT_ID.test(String(id))) throw new Refused("No such record: " + id);
    return { ...alive, _id: String(id) };
  };
  // A filter names fields only. A name the table doesn't have would be dropped by the checks, and the
  // filter would quietly match every record, so it is refused instead.
  const fields = Object.keys(Model.schema.paths).filter((p) => !["_id", "__v", "createdAt", "updatedAt", "deletedAt"].includes(p));
  const where = (filter) => {
    for (const key of Object.keys(filter ?? {})) {
      if (!fields.includes(key)) throw new Refused('filter: "' + key + '" is not a field of this table (to change one record, use helpers.update(id, changes))');
    }
    return { ...alive, ...check(filter, true) };
  };
  return {
    get: async (id) => plain(await Model.findOne(byId(id))),
    list: async (filter) => (await Model.find(where(filter)).limit(LIST_CAP)).map(plain),
    create: async (values) => plain(await Model.create(check(values, false))),
    update: async (id, changes) => {
      const record = await Model.findOneAndUpdate(byId(id), { $set: check(changes, true) }, { returnDocument: "after", runValidators: true });
      if (!record) throw new Refused("No such record: " + id);
      return plain(record);
    },
    updateMany: async (filter, changes) =>
      (await Model.updateMany(where(filter), { $set: check(changes, true) })).modifiedCount,
    remove: async (id) => {
      const record = alive.deletedAt === null
        ? await Model.findOneAndUpdate(byId(id), { $set: { deletedAt: new Date() } })
        : await Model.findOneAndDelete(byId(id));
      if (!record) throw new Refused("No such record: " + id);
      return true;
    },
  };
}

/**
 * Runs backend/custom/<name>.js for one button press. Returns null when the code isn't written (yet),
 * else { status, body }: 200 its answer, 400 when it refuses, 404 no such record, 500 a mistake in it.
 */
export async function runCustom({ name, Model, validate, id, input }) {
  let source;
  try {
    source = await readFile(path.join(HERE, name + ".js"), "utf8");
  } catch {
    return null;
  }
  const work = tableHelpers(Model, validate);
  let record = null;
  if (id !== null && id !== undefined) {
    record = await work.get(id).catch(() => null);
    if (!record) return { status: 404, body: { error: "Record not found" } };
  }

  const worker = new Worker(new URL("./worker.js", import.meta.url), {
    workerData: { source, record: JSON.stringify(record), input: JSON.stringify(input ?? {}) },
    env: {}, // no settings or keys inside
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
    stdout: true,
    stderr: true,
  });
  const answer = await new Promise((resolve) => {
    let settled = false;
    let waiting = 0; // helper calls on their way: the database's time, not the code's
    let quiet;
    const end = (json) => {
      if (settled) return;
      settled = true;
      clearTimeout(quiet);
      clearTimeout(total);
      worker.terminate();
      resolve(json);
    };
    const tooLong = () => end(JSON.stringify({ ok: false, error: "took too long" }));
    const watch = () => {
      clearTimeout(quiet);
      if (waiting === 0) quiet = setTimeout(tooLong, QUIET_MS);
    };
    const total = setTimeout(tooLong, TOTAL_MS);
    worker.on("message", async (message) => {
      if (message.type === "done") return end(message.json);
      if (message.type !== "call") return;
      waiting++;
      clearTimeout(quiet);
      let reply;
      try {
        if (!Object.hasOwn(work, message.op)) throw new Error("unknown helper " + message.op);
        const value = await work[message.op](...JSON.parse(message.args));
        reply = JSON.stringify({ ok: true, value: value === undefined ? null : value });
      } catch (err) {
        reply = JSON.stringify({ ok: false, refused: err instanceof Refused, error: err.message });
      }
      waiting--;
      if (settled) return;
      worker.postMessage({ type: "reply", id: message.id, json: reply });
      watch();
    });
    worker.on("error", (err) => end(JSON.stringify({ ok: false, error: err.message })));
    worker.on("exit", () => end(JSON.stringify({ ok: false, error: "stopped without an answer" })));
    watch();
  });

  const result = JSON.parse(answer);
  if (result.ok) return { status: 200, body: result.value };
  if (result.refused) return { status: 400, body: { error: result.error } };
  return { status: 500, body: { error: "custom code failed: " + result.error } };
}
`;

export const workerFile = () => String.raw`// One press of a custom button (started by run.js). The button's code runs in a room inside this
// worker: no process, no require, no globals of this worker, and no code made from strings. It reaches
// the database only through its helpers, which ask run.js with plain text.
import vm from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

// Defined here, but created INSIDE the room (from its text), so its functions belong to the room.
// bridge and finish come from outside; they stay in this closure, out of the code's reach.
function room(bridge, finish) {
  const ask = (op, args) =>
    new Promise((resolve, reject) => {
      bridge(op, JSON.stringify(args), (answer) => {
        const a = JSON.parse(answer);
        if (a.ok) resolve(a.value);
        else reject(Object.assign(new Error(a.error), { refused: a.refused }));
      });
    });
  const helpers = Object.freeze({
    get: (id) => ask("get", [id]),
    list: (filter) => ask("list", [filter || {}]),
    create: (values) => ask("create", [values]),
    update: (id, changes) => ask("update", [id, changes]),
    updateMany: (filter, changes) => ask("updateMany", [filter, changes]),
    remove: (id) => ask("remove", [id]),
    fail: (message) => {
      throw Object.assign(new Error(String(message)), { refused: true });
    },
  });
  return (fn, recordJson, inputJson) => {
    Promise.resolve()
      .then(() => fn({ record: JSON.parse(recordJson), input: JSON.parse(inputJson), helpers }))
      .then(
        (out) => {
          try {
            finish(JSON.stringify({ ok: true, value: out && typeof out === "object" ? out : {} }));
          } catch {
            finish(JSON.stringify({ ok: false, error: "its answer could not be read" }));
          }
        },
        (err) => finish(JSON.stringify({ ok: false, refused: Boolean(err && err.refused), error: String((err && err.message) || err) }))
      );
  };
}

const replies = new Map();
let nextId = 0;
parentPort.on("message", (message) => {
  if (message.type !== "reply") return;
  const reply = replies.get(message.id);
  replies.delete(message.id);
  if (reply) reply(message.json);
});
const bridge = (op, args, reply) => {
  const id = ++nextId;
  replies.set(id, reply);
  parentPort.postMessage({ type: "call", id, op, args });
};
const finish = (json) => parentPort.postMessage({ type: "done", json });

try {
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  const fn = vm.runInContext("(" + workerData.source.replace(/^\s*export\s+default\s+/, "") + ")", context);
  if (typeof fn !== "function") throw new Error("it is not a function");
  vm.runInContext("(" + room.toString() + ")", context)(bridge, finish)(fn, workerData.record, workerData.input);
} catch (err) {
  finish(JSON.stringify({ ok: false, error: String(err && err.message) }));
}
`;
