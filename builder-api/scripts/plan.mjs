// Step 32b: a person's workspace plan (free or pro), until payments set it (Stage 7).
//   npm run plan -- set someone@example.com pro
//   npm run plan -- show someone@example.com
import mongoose from "mongoose";
import { loadConfig } from "../src/config.js";
import { normalEmail } from "../src/auth/invites.js";
import { User } from "../src/models/user.js";
import { Workspace } from "../src/models/workspace.js";
import { quotaOf } from "../src/quotas.js";

const [command, email, plan] = process.argv.slice(2);
const config = loadConfig(process.env);
await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000 });
try {
  const user = email && (await User.findOne({ email: normalEmail(email) }));
  const workspace = user && (await Workspace.findOne({ ownerId: user._id, personal: true }));
  if (!["set", "show"].includes(command) || (command === "set" && !["free", "pro"].includes(plan))) {
    console.log("Usage: npm run plan -- set <email> free|pro | show <email>");
    process.exitCode = 1;
  } else if (!workspace) {
    console.log(`${email} has not signed in yet (no workspace)`);
    process.exitCode = 1;
  } else {
    if (command === "set") await Workspace.updateOne({ _id: workspace._id }, { plan });
    const quota = await quotaOf(await Workspace.findById(workspace._id), config.quotas);
    console.log(`${user.email}: ${quota.plan} plan, ${quota.used} of ${quota.limit} builds used (${quota.days === 1 ? "a day" : `every ${quota.days} days`})`);
  }
} finally {
  await mongoose.disconnect();
}
