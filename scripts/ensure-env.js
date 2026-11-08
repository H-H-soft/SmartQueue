import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const envPath = new URL('../.env', import.meta.url);
const examplePath = new URL('../.env.example', import.meta.url);

let env;
try {
  env = await readFile(envPath, 'utf8');
} catch {
  env = await readFile(examplePath, 'utf8');
}

const currentKey = env.match(/^STAFF_API_KEY=(.*)$/m)?.[1]?.trim();
if (!currentKey || currentKey.length < 32 || currentKey.startsWith('replace-')) {
  const staffKey = randomBytes(32).toString('hex');
  if (/^STAFF_API_KEY=.*$/m.test(env)) {
    env = env.replace(/^STAFF_API_KEY=.*$/m, `STAFF_API_KEY=${staffKey}`);
  } else {
    env += `${env.endsWith('\n') ? '' : '\n'}STAFF_API_KEY=${staffKey}\n`;
  }
  await writeFile(envPath, env, { mode: 0o600 });
  console.log('Prepared local .env with a private staff key.');
}
