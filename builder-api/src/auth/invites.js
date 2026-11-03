// Step 29: the beta's invite list (scripts/invite.mjs adds, lists and removes).
import { Invite } from "../models/invite.js";

export const normalEmail = (email) => String(email ?? "").trim().toLowerCase();

export async function invite(email, note) {
  const address = normalEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new Error(`"${email}" is not an email address`);
  await Invite.updateOne({ email: address }, { $setOnInsert: { email: address, ...(note && { note }) } }, { upsert: true });
  return address;
}

export const uninvite = async (email) => (await Invite.deleteOne({ email: normalEmail(email) })).deletedCount === 1;
export const listInvites = () => Invite.find().sort({ createdAt: 1 }).lean();
export const isInvited = async (email) => Boolean(email) && (await Invite.exists({ email: normalEmail(email) })) !== null;
