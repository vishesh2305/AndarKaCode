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
