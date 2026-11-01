// Embed local PNGs because DSH's external client loader serves one JS module,
// not arbitrary package assets. No bundler or installation is required.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('.', import.meta.url);
const names = ['lead', 'research', 'code', 'write', 'data', 'qa'];
const images = {};
for (const name of names) {
  const file = await readFile(new URL(`avatars/${name}.png`, root));
  images[name] = `data:image/png;base64,${file.toString('base64')}`;
}
const template = await readFile(new URL('client.template.js', root), 'utf8');
const pattern = /\/\* AVATAR_DATA \*\/[\s\S]*?\/\* END_AVATAR_DATA \*\//;
if (!pattern.test(template)) throw new Error('Avatar placeholder missing');
const output = template.replace(pattern, JSON.stringify(images));
const target = new URL('client.js', root);
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) throw new Error('client.js is out of date; run node build.mjs');
} else {
  await writeFile(target, output);
}
