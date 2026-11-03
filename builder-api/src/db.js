import mongoose from "mongoose";

export async function connectDb(uri) {
  // Fail fast with a clear message instead of hanging when MongoDB is not running.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}

export const isDbConnected = () => mongoose.connection.readyState === 1;

/** One round trip to MongoDB (Step 28: how far server 1 is). */
export const pingDb = () => mongoose.connection.db.admin().ping();
