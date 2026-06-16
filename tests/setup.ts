import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Silence the SMS gateway (NotificationService delegates to it). Keeps test
// output clean and removes any external dependency.
jest.mock("../src/utils/sms", () => ({
  smsProvider: { send: jest.fn().mockResolvedValue(undefined) },
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
