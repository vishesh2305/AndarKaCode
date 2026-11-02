// Step 23c: every custom button gets its code at the same time. Each button is pressed in the generated
// app on its own throwaway database, because a press empties its database first.
import { runPool } from "../pool.js";

const CUSTOM_LIMIT = Number(process.env.CUSTOM_PARALLEL ?? 3);

/** The throwaway database for button number i (0-based) of a project: unique, under MongoDB's 63 characters. */
export const buttonDatabase = (projectId, i) => `custom_${projectId}_${i + 1}`;

/** writeOne(op, index) for every custom operation, at most `limit` at once; results in the operations' order. */
export const writeButtons = (ops, { limit = CUSTOM_LIMIT, writeOne }) => runPool(ops, limit, writeOne);
