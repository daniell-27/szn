import mongoose from "mongoose";

// Connect to MongoDB. In development, if no MONGODB_URI is set, spin up an
// in-memory MongoDB so the app runs with zero setup. In production a real
// MONGODB_URI (local mongod or Atlas) is required.
export async function connectDB() {
  let uri = process.env.MONGODB_URI;

  if (!uri) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MONGODB_URI is required in production.");
    }
    console.log("No MONGODB_URI set — starting a temporary in-memory MongoDB (dev only).");
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const mem = await MongoMemoryServer.create();
    uri = mem.getUri();
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { dbName: "szn" });
  console.log("MongoDB connected.");
}
