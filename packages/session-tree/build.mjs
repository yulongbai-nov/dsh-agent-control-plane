// Embed local PNGs and the shared lineage source because DSH's external client
// loader serves one JS module, not arbitrary package assets or local imports.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Script } from 'node:vm';

const EXPORTS = 'export { catalogOf, buildRows, navigationTarget };';

function replaceUniqueMarked(template, start, end, replacement) {
  const firstStart = template.indexOf(start), firstEnd = template.indexOf(end);
  if (firstStart < 0 || firstEnd < firstStart + start.length ||
      template.indexOf(start, firstStart + start.length) !== -1 ||
      template.indexOf(end, firstEnd + end.length) !== -1) {
    throw new Error(`Missing, duplicate, or out-of-order marker: ${start}`);
  }
  return template.slice(0, firstStart) + replacement + template.slice(firstEnd + end.length);
}

// The module uses one fixed trailing export statement; everything before it is
// the same code consumed by ESM importers, wrapped to keep helpers private.
export function renderClient(template, images, lineage) {
  // Do not execute either script. Parsing the original also catches broken code
  // in placeholder regions that the substitution would otherwise erase.
  new Script(template, { filename: 'session-tree-template.js' });
  const avatarStart = '/* AVATAR_DATA */', avatarEnd = '/* END_AVATAR_DATA */';
  const lineageStart = '/* LINEAGE_SOURCE */', lineageEnd = '/* END_LINEAGE_SOURCE */';
  // Validate both pairs against the original template before either replacement.
  replaceUniqueMarked(template, avatarStart, avatarEnd, '');
  replaceUniqueMarked(template, lineageStart, lineageEnd, '');
  if (template.indexOf(avatarStart) < template.indexOf(lineageStart)
      ? template.indexOf(avatarEnd) > template.indexOf(lineageStart)
      : template.indexOf(lineageEnd) > template.indexOf(avatarStart)) {
    throw new Error('Overlapping source markers');
  }
  const trimmed = lineage.trimEnd();
  if (!trimmed.endsWith(EXPORTS) || trimmed.indexOf(EXPORTS) !== trimmed.lastIndexOf(EXPORTS)) {
    throw new Error('Unexpected lineage exports');
  }
  const body = trimmed.slice(0, -EXPORTS.length);
  const embedded = `const { catalogOf, buildRows, navigationTarget } = (() => {\n${body}\nreturn { catalogOf, buildRows, navigationTarget };\n})();`;
  const withImages = replaceUniqueMarked(template, avatarStart, avatarEnd, JSON.stringify(images));
  const output = replaceUniqueMarked(withImages, lineageStart, lineageEnd, embedded);
  // Parse as a browser script without executing it before either --check or write.
  new Script(output, { filename: 'session-tree-client.js' });
  return output;
}

async function main() {
  // Resolve the actual package directory even with --preserve-symlinks-main.
  const root = new URL('.', pathToFileURL(await realpath(fileURLToPath(import.meta.url))));
  const names = ['lead', 'research', 'code', 'write', 'data', 'qa'];
  const images = {};
  for (const name of names) {
    const file = await readFile(new URL(`avatars/${name}.png`, root));
    images[name] = `data:image/png;base64,${file.toString('base64')}`;
  }
  const template = await readFile(new URL('client.template.js', root), 'utf8');
  const lineage = await readFile(new URL('lineage.mjs', root), 'utf8');
  const output = renderClient(template, images, lineage);
  const target = new URL('client.js', root);
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== output) throw new Error('client.js is out of date; run node build.mjs');
  } else {
    await writeFile(target, output);
  }
}
// Use the runtime's entry flag when available. Older supported Node builds
// use a canonical-path fallback, including symlinks in file or parent paths.
// Loading and invoking a module as main must use one path consistently.
function isMainFallback() {
  if (!process.argv[1]) return false;
  const modulePath = fileURLToPath(import.meta.url);
  // An exact entry is definitely a direct invocation even if it disappears
  // before we inspect it; main() then fails loudly rather than silently skips.
  if (resolve(process.argv[1]) === modulePath) return true;
  try { return realpathSync(process.argv[1]) === realpathSync(modulePath); }
  catch (error) {
    // `node -e` / stdin / external import can supply a non-path argument.
    if (['ENOENT', 'ENOTDIR', 'EINVAL'].includes(error?.code)) return false;
    throw error;
  }
}
if (import.meta.main ?? isMainFallback()) await main();
