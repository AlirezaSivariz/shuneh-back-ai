import mongoose from 'mongoose';
import { config } from './env';
import { childLogger } from '../utils/logger';

const log = childLogger({ module: 'db' });

// Options tuned for hosted MongoDB (Atlas) reliability:
// - connectTimeoutMS: 10s (the driver default) is too short for a cluster cold
//   start — the TCP/TLS handshake alone can take longer, which surfaces as
//   "connect ETIMEDOUT" and a PoolClearedError that cascades across requests.
// - socketTimeoutMS: the default 0 lets a stalled operation hang a request
//   forever; a finite budget makes degraded connections fail fast instead.
// - maxPoolSize: the default 100 connections is far more than one Node process
//   needs and hammers a shared/free tier during recovery.
export const mongooseOptions: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 30_000,
  connectTimeoutMS: 30_000,
  socketTimeoutMS: 120_000,
  heartbeatFrequencyMS: 10_000,
  maxPoolSize: 20,
  retryWrites: true,
  retryReads: true,
};

/**
 * Connect to MongoDB. Resolves once the connection is open.
 */
export async function connectDb(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);

  // A cleared pool (e.g. a flaky network handshake) is normally recovered by the
  // driver's own reconnect logic; log it so the incident is visible in metrics.
  mongoose.connection.on('connected', () => {
    log.info('MongoDB connected');
  });
  mongoose.connection.on('error', (err) => {
    log.error({ err }, 'MongoDB connection error');
  });

  await mongoose.connect(config.mongoUri, mongooseOptions);
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
