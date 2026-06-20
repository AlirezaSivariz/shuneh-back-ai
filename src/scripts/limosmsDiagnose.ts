/* eslint-disable no-console */
/**
 * Standalone LimoSMS diagnostic. Calls the REAL sendcode endpoint with your env
 * config and prints exactly what the gateway returns (HTTP status + raw body +
 * Success/Message) so the true reason a request is rejected is visible.
 *
 * Run:  npm run diag:limosms -- 09xxxxxxxxx
 * (uses LIMOSMS_API_KEY / LIMOSMS_FOOTER from your environment / .env)
 */
import { config } from '../config/env';
import { toLimoMobile } from '../utils/sms';

async function run() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: npm run diag:limosms -- 09xxxxxxxxx');
    process.exit(1);
  }
  const mobile = toLimoMobile(input);

  console.log('--- LimoSMS sendcode diagnostic ---');
  console.log('SMS_DRIVER      :', config.smsDriver);
  console.log('ApiKey present  :', config.limoSmsApiKey ? `yes (len=${config.limoSmsApiKey.length})` : 'NO — set LIMOSMS_API_KEY');
  console.log('Footer          :', config.limoSmsFooter);
  console.log('Mobile (input)  :', input);
  console.log('Mobile (sent)   :', mobile);

  if (!config.limoSmsApiKey) process.exit(1);

  const res = await fetch('https://api.limosms.com/api/sendcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ApiKey: config.limoSmsApiKey },
    body: JSON.stringify({ Mobile: mobile, Footer: config.limoSmsFooter }),
  });
  const raw = await res.text().catch(() => '');
  console.log('\nHTTP status     :', res.status);
  console.log('Raw body        :', raw || '(empty)');
  try {
    const json = JSON.parse(raw);
    console.log('Parsed Success  :', json.Success ?? json.success);
    console.log('Parsed Message  :', json.Message ?? json.message);
  } catch {
    console.log('(body is not valid JSON)');
  }
  console.log('-----------------------------------');
}

run().catch((e) => {
  console.error('Request threw (network/DNS/TLS):', e);
  process.exit(1);
});
