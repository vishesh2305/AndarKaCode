// Step 29: who a signed-in profile is. A known identity, or a known verified email, is that person; anyone
// else needs an invite. Each person gets one personal workspace at their first sign-in.
import { Invite } from "../models/invite.js";
import { User } from "../models/user.js";
import { Workspace } from "../models/workspace.js";
import { isInvited } from "./invites.js";

const DUPLICATE = 11000; // two sign-ins of the same person at the same moment

async function once(create, find) {
  try {
    return await create();
  } catch (err) {
    if (err.code !== DUPLICATE) throw err;
    return find();
  }
}

/** { user, workspace }, or { refused: "not-verified" | "not-invited" }. */
export async function accountFor(profile) {
  if (!profile.email || !profile.emailVerified) return { refused: "not-verified" };
  const identity = { provider: profile.provider, subject: profile.subject };
  let user = (await User.findOne({ identities: { $elemMatch: identity } })) ?? (await User.findOne({ email: profile.email }));
  if (!user) {
    if (!(await isInvited(profile.email))) return { refused: "not-invited" };
    user = await once(
      () => User.create({ email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl, identities: [identity] }),
      () => User.findOne({ email: profile.email })
    );
    await Invite.updateOne({ email: profile.email, usedAt: { $exists: false } }, { usedAt: new Date() });
  }
  user = await User.findByIdAndUpdate(
    user._id,
    {
      $addToSet: { identities: identity },
      $set: { lastSignInAt: new Date(), ...(profile.name && !user.name && { name: profile.name }), ...(profile.avatarUrl && { avatarUrl: profile.avatarUrl }) },
    },
    { new: true }
  );
  const personal = { ownerId: user._id, personal: true };
  const workspace = await once(
    () =>
      Workspace.findOneAndUpdate(
        personal,
        { $setOnInsert: { ...personal, name: `${user.name || user.email}'s workspace`, members: [{ userId: user._id, role: "owner" }] } },
        { upsert: true, new: true }
      ),
    () => Workspace.findOne(personal)
  );
  return { user, workspace };
}
