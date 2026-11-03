// Step 29: the beta's invite list. Only these emails (verified by GitHub or Google) get an account.
//   npm run invite -- add someone@example.com ["a note"]
//   npm run invite -- remove someone@example.com
//   npm run invite -- list
import mongoose from "mongoose";
import { invite, listInvites, uninvite } from "../src/auth/invites.js";
import { loadConfig } from "../src/config.js";

const [command, email, note] = process.argv.slice(2);
const { mongodbUri } = loadConfig(process.env);
await mongoose.connect(mongodbUri, { serverSelectionTimeoutMS: 5000 });
try {
  if (command === "add" && email) console.log(`Invited ${await invite(email, note)}`);
  else if (command === "remove" && email) console.log((await uninvite(email)) ? `Removed ${email}` : `${email} was not invited`);
  else if (command === "list") {
    const invites = await listInvites();
    for (const i of invites) console.log(`${i.email}${i.usedAt ? `  signed in ${i.usedAt.toISOString().slice(0, 10)}` : "  not signed in yet"}${i.note ? `  (${i.note})` : ""}`);
    if (!invites.length) console.log("No invites yet: npm run invite -- add someone@example.com");
  } else {
    console.log("Usage: npm run invite -- add <email> [note] | remove <email> | list");
    process.exitCode = 1;
  }
} finally {
  await mongoose.disconnect();
}
