// Which AI did a piece of work: the server's own models; with a workspace's own key, its provider
// (shared/providers.mjs PROVIDERS, Step 31c).
export const SERVER_MODELS = ["local", "cloud"];

// Shared by every model: createdAt/updatedAt, and JSON with `id` instead of `_id`/`__v`.
export const schemaOptions = {
  timestamps: true,
  toJSON: {
    versionKey: false,
    transform(_doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      return ret;
    },
  },
};
