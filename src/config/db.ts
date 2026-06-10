import mongoose from 'mongoose';
import { config } from './env';

/**
 * Connect to MongoDB. Resolves once the connection is open.
 */
export async function connectDb(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    // eslint-disable-next-line no-console
    console.log('[db] connected');
  });
  mongoose.connection.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[db] connection error:', err.message);
  });

  await mongoose.connect(config.mongoUri);
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
