import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const seconds = process.argv[2] || '30';
const key = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
if (!key || !['30', '90'].includes(seconds)) {
  console.error('Set ELEVENLABS_API_KEY and pass a track length of 30 or 90 seconds.');
  process.exit(1);
}
function run(args, env = process.env) {
  const result = spawnSync('npm', args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const usage = async () => {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(7_000),
    });
    return response.ok ? (await response.json()).character_count : undefined;
  } catch {
    return undefined;
  }
};
const before = await usage();
run(['run', 'build']);
run(['exec', 'playwright', 'test'], {
  ...process.env, ELEVENLABS_API_KEY: key, LIVE_MUSIC_SECONDS: seconds,
});
const after = await usage();
if (typeof before === 'number' && typeof after === 'number') {
  console.log('Account-wide credit count delta during smoke:', after - before);
} else {
  console.log('Account credit count is unavailable with this API key.');
}
