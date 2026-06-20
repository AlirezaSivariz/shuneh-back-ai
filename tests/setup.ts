// Integration tests attach tiny non-image buffers and use an in-memory Mongo, so
// force the disk storage driver here (set before config's dotenv runs; dotenv
// won't override an already-set var). The Mongo image pipeline is covered
// directly in storage.test.ts. Also drop the Atlas URI so nothing points at it.
process.env.STORAGE_DRIVER = "local";
delete process.env.MONGODB_URI;

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Mock the SMS gateway: no external calls. OTP uses a fixed code (123456) so the
// existing auth tests keep working; generic send is a no-op.
jest.mock("../src/utils/sms", () => ({
  smsProvider: {
    send: jest.fn().mockResolvedValue(undefined),
    sendOtp: jest.fn().mockResolvedValue({ devCode: "123456" }),
    verifyOtp: jest.fn(async (_phone: string, code: string) => code === "123456"),
  },
}));

// Silence the HTTP request logger (morgan) during tests.
jest.mock("morgan", () => () => (_req: unknown, _res: unknown, next: () => void) => next());

// Quiet the DB connect/log noise.
jest.spyOn(console, "log").mockImplementation(() => {});

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60000);

// Reset all data between tests so each one is independent and repeatable.
afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
