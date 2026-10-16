import mongoose from "mongoose";

export async function connectDb(uri) {
  // Fail fast with a clear message instead of hanging when MongoDB is not running.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}

export const isDbConnected = () => mongoose.connection.readyState === 1;
