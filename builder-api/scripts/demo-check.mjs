// Evaluation plan A5: is everything a demo needs up? Run it an hour before presenting.
//   npm run demo:check            one line per service, and how to fix what is down
//   npm run demo:check -- --warm  also load the local models for an hour, so the first build isn't slow
// Exits 1 when something is down.
import mongoose from "mongoose";
import { demoCheck, formatCheck } from "../src/demo-check.js";

const warm = process.argv.includes("--warm");
const mongo = async (uri) => {
  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 3000 }).asPromise();
  await connection.close();
};

const results = await demoCheck({ env: process.env, mongo, warm });
console.log(formatCheck(results));
process.exit(results.every((r) => r.ok) ? 0 : 1);
