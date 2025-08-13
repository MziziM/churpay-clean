import cron from 'node-cron';
import { exec } from 'child_process';

// Cron expression from env or default: every day at 00:00
const CRON = process.env.EXPORT_CRON || '0 0 * * *';
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log(`[Scheduler] Starting with CRON="${CRON}" (NODE_ENV=${NODE_ENV})`);

// Validate the cron expression
if (!cron.validate(CRON)) {
  console.error(`[Scheduler] Invalid CRON expression: ${CRON}`);
  process.exit(1);
}

function runExport() {
  console.log(`[Scheduler] Running export at ${new Date().toLocaleString()} ...`);
  const child = exec('node scripts/exportPayments.js', { env: { ...process.env, NODE_ENV } });
  child.stdout.on('data', (d) => process.stdout.write(d));
  child.stderr.on('data', (d) => process.stderr.write(d));
  child.on('close', (code) => console.log(`[Scheduler] Export finished with code ${code}`));
}

// Run once on start (optional)
runExport();

// Schedule next runs
cron.schedule(CRON, runExport, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });