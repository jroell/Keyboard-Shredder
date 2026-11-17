import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const folder = new URL('./weights/', import.meta.url);
const file = new URL('final0.ckpt', folder);
const temp = new URL('final0.ckpt.partial', folder);
const expected = '8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331';
async function verify(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex') === expected;
}

await mkdir(folder, { recursive: true });
if (!await verify(file).catch(() => false)) {
  try {
    const result = await fetch('https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt', {
      signal: AbortSignal.timeout(120_000),
    });
    if (!result.ok) throw new Error(`Beat model download failed (HTTP ${result.status}).`);
    await pipeline(Readable.fromWeb(result.body), createWriteStream(temp));
    if (!await verify(temp)) throw new Error('Beat model checksum did not match the pinned checkpoint.');
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
console.log('Beat model verified.');
