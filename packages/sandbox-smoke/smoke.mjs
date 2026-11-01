import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const base = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/';
const artifacts = {
  'dsh-web-frontend/dist/assets/index-BXV-oxvX.js': '0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0',
  'dsh-client-ui-renderer/lib/client.js': 'dbdb3f26bfbc1d143bc8a0eed5982a2507c4f0cf8027e7c170f3bed3604be356',
  'dsh-client-modules/lib/client.js': '426084f8672c26a469566a3f43c91a9b0d1dd73d0834028e553a6d0fa9cffa44',
  'dsh-client-locale/lib/client.js': 'f432091187e11d464387a34e4d4e0b6c72afd02dc9ddecad62d1686475c151a1',
  'cordis/lib/index.js': '6a9394c0877ff45218818c6e815edd038f8057e1a1deb390a8d43ec81c57691e',
  'dsh-session/lib/index.js': '2f5dd07cb5c744a29abbb8003a8a4cefd9e582c6e2538074ca299a0ddd02a3bf',
  'dsh-session-projection/lib/index.js': '7dc2b212819baf4fc292751054d30b97afcbdee0a4733230abf92c6722e6550c',
  'dsh-subagent/lib/index.js': '9a9572e70fffdb100deb63326167f32bbf63016ce49c0017495dabcb95b44168',
};

export function guardedBytes(bytes, expected, label) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`fingerprint mismatch: ${label}`);
  return bytes.toString('utf8');
}

async function installed(path) {
  return guardedBytes(await readFile(base + path), artifacts[path], path);
}

export function slotCoreSource(shell) {
  // shortcut: SlotCore is embedded in one exact rc.5 shell; re-audit its fingerprint on upgrade.
  const start = shell.indexOf('function kI(e)');
  const end = shell.indexOf('const jI=', start);
  if (start < 0 || end < 0 || shell.indexOf('function kI(e)', start + 1) !== -1 || shell.indexOf('const jI=', end + 1) !== -1) throw new Error('unexpected SlotCore boundaries');
  return guardedBytes(Buffer.from(shell.slice(start, end)), '497c1c172d61540b5b5c1e2ac9da3368dc2bd759b730cdc72b3bff9d9a53a49d', 'SlotCore slice');
}

export async function createHarness() {
  if (!process.versions.electron) throw new Error('run with the installed Electron binary in Node mode');
  for (const [pkg, version] of [['dsh-web-frontend', '0.2.1-rc.5'], ['dsh-client-ui-renderer', '0.2.1-rc.5'], ['dsh-client-modules', '0.2.1-rc.5'], ['dsh-client-locale', '0.2.1-rc.5'], ['dsh-session', '0.2.1-rc.5'], ['dsh-session-projection', '0.2.1-rc.5'], ['dsh-subagent', '0.2.1-rc.5'], ['cordis', '4.0.5']]) {
    const manifest = JSON.parse(await readFile(`${base}${pkg}/package.json`, 'utf8'));
    if (manifest.version !== version) throw new Error(`unsupported ${pkg} version ${manifest.version}`);
  }
  const [shell, rendererSource, loaderSource, localeSource] = await Promise.all([
    installed('dsh-web-frontend/dist/assets/index-BXV-oxvX.js'),
    installed('dsh-client-ui-renderer/lib/client.js'),
    installed('dsh-client-modules/lib/client.js'),
    installed('dsh-client-locale/lib/client.js'),
    installed('cordis/lib/index.js'),
    installed('dsh-session/lib/index.js'),
    installed('dsh-session-projection/lib/index.js'),
    installed('dsh-subagent/lib/index.js'),
  ]);
  const cordis = await import(`file://${base}cordis/lib/index.js`);
  const { SessionStore } = await import(`file://${base}dsh-session/lib/index.js`);
  const { SessionProjectionRegistry } = await import(`file://${base}dsh-session-projection/lib/index.js`);
  const { default: Subagents } = await import(`file://${base}dsh-subagent/lib/index.js`);
  const target = { mode: 'queue', pendingQueue: [], load(registration) { this.pendingQueue.push(registration); } };
  const sandbox = vm.createContext({ window: { __ModuleLoader__: target }, queueMicrotask });
  vm.runInContext(loaderSource, sandbox, { filename: 'rc5-client-modules.js', timeout: 1000 });
  const bootstrap = target.pendingQueue.shift();
  if (bootstrap?.id !== '@deepseek-ai/dsh-client-modules' || target.pendingQueue.length !== 0) throw new Error('unexpected bootstrap registration');
  const loader = bootstrap.factory((id) => { throw new Error(`unexpected bootstrap dependency: ${id}`); });

  const slice = slotCoreSource(shell);
  const slotCore = vm.runInContext(`(()=>{${slice};return {SlotCore:SI, standardHookPropName:kI}})()`, sandbox, { filename: 'rc5-slot-core.js', timeout: 1000 });
  const react = { createContext: () => ({}), Component: class {}, useSyncExternalStore() {} };
  const modules = loader.createClientModuleSystem(target, { id: bootstrap.id, exports: loader }, {
    boot: { rev: 'isolated-smoke', release: { version: '0.2.1-rc.5' }, entries: [], batches: [] },
    staticModules: { react, 'react-dom': {}, 'react-dom/client': {}, 'react/jsx-runtime': {}, '@deepseek-ai/dsh-client-ui-slots': slotCore, '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-ui-primitives': {}, '@deepseek-ai/dsh-client-store': {} },
    loadBundle() { throw new Error('bundle transport disabled in isolated smoke'); },
  });
  vm.runInContext(rendererSource, sandbox, { filename: 'rc5-ui-renderer.js', timeout: 1000 });
  vm.runInContext(localeSource, sandbox, { filename: 'rc5-client-locale.js', timeout: 1000 });
  const browserSource = await readFile(new URL('../session-tree/client.js', import.meta.url), 'utf8');
  vm.runInContext(browserSource, sandbox, { filename: 'session-tree-client.js', timeout: 1000 });
  const renderer = await modules.import('@deepseek-ai/dsh-client-ui-renderer');
  const { LocaleRuntime } = await modules.import('@deepseek-ai/dsh-client-locale');
  const browser = await modules.import('dsh-session-tree');
  const host = await import('../session-tree/index.js');
  const ctx = new cordis.Context();
  const hostCtx = new cordis.Context();
  const calls = [], events = [];
  try {
    await hostCtx.plugin(SessionStore);
    await hostCtx.plugin(SessionProjectionRegistry);
    await hostCtx.plugin({ name: 'smoke-working-directory', apply(ctx) { ctx.reflect.provide('workingDirectory', {}); } });
    await hostCtx.plugin(Subagents, {});
    const hostFiber = await hostCtx.plugin(host);
    await ctx.plugin({ name: 'smoke-slot-registry', apply(ctx) { new renderer.SlotRegistry(ctx); } });
    await ctx.plugin({ name: 'smoke-locale', inject: ['slots'], apply(ctx) {
      const locale = new LocaleRuntime(ctx, undefined, { languages: ['zh'], preference: null });
      ctx.reflect.provide('locale', locale);
      ctx.slots.installLocale(locale);
    } });
    ctx.on('slots/changed', (name) => events.push(name));
    const declarationsPlugin = { name: 'smoke-slot-declarations', inject: ['slots'], apply(ctx) {
      ctx.slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, sidebar: { kind: 'single', scope: 'root' } } }, () => null);
      ctx.slots.register({ name: 'sidebar', children: { 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null);
    } };
    const declare = () => ctx.plugin(declarationsPlugin);
    const declarations = await declare();
    await ctx.plugin({ name: 'smoke-stand-in-services', apply(ctx) {
      ctx.reflect.provide('sessions', { refreshProjections(id) { calls.push(['refreshProjections', id]); }, refresh() { calls.push(['refresh']); } });
      ctx.reflect.provide('uiWorkspace', { openSession(target) { calls.push(['openSession', target]); } });
    } });
    const activate = () => ctx.plugin(browser);
    const plugin = await activate();
    return { ctx, hostCtx, host: hostFiber, browser, plugin, activate, declarations, declare, calls, events, close: async () => {
      try { await ctx.fiber.dispose(); } finally { await hostCtx.fiber.dispose(); }
    } };
  } catch (error) {
    try { await ctx.fiber.dispose(); } finally { await hostCtx.fiber.dispose(); }
    throw error;
  }
}
