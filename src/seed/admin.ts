import { connectDb, disconnectDb } from '../config/db';
import { config } from '../config/env';
import { User } from '../models/User';

/**
 * Idempotent bootstrap of the FIRST admin from `ADMIN_PHONE`. This is the ONLY
 * way to mint an admin — there is no admin path through OTP/registration. Run
 * manually: `ADMIN_PHONE=09xxxxxxxxx npm run seed:admin`.
 *
 * It upserts the user by phone and ensures 'admin' is in their roles (also
 * re-activates the account). It never removes other roles.
 */
async function run() {
  const phone = process.argv[2] || config.adminPhone;
  if (!phone || !/^09\d{9}$/.test(phone)) {
    // eslint-disable-next-line no-console
    console.error('[seed:admin] set ADMIN_PHONE (09xxxxxxxxx) in env or pass it as an argument.');
    process.exit(1);
  }

  await connectDb();
  const user = await User.findOne({ phone });
  if (!user) {
    await User.create({ phone, roles: ['admin'], isActive: true });
    // eslint-disable-next-line no-console
    console.log(`[seed:admin] created admin ${phone}`);
  } else {
    if (!user.roles.includes('admin')) user.roles.push('admin');
    user.isActive = true;
    await user.save();
    // eslint-disable-next-line no-console
    console.log(`[seed:admin] granted admin to existing user ${phone}`);
  }
  await disconnectDb();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed:admin] failed:', err);
  process.exit(1);
});
