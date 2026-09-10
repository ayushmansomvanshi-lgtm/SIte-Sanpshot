import { execSync } from 'child_process';

const isVercel = Boolean(process.env.VERCEL);
const cmd = isVercel ? 'npx playwright install chromium' : 'npx playwright install --with-deps';

console.log(`Playwright install script running. Vercel=${isVercel}. Command: ${cmd}`);

try {
  execSync(cmd, { stdio: 'inherit' });
} catch (err) {
  console.error('Playwright install failed:', err && err.message ? err.message : err);
  if (isVercel) {
    console.warn('Running on Vercel — continuing despite install failure to avoid apt-get errors.');
  } else {
    process.exit(1);
  }
}
