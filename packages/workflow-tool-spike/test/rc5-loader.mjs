// Test-only resolver for the two pinned rc.5 peer dependencies; no installation or profile changes.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const requireFromInstalled = createRequire('file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tool-workflow/lib/index.js');
export function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith('/workflow-tool-spike/fork.mjs') && (specifier === '@deepseek-ai/schemastery' || specifier === '@deepseek-ai/dsh-tools')) {
    return { url: pathToFileURL(requireFromInstalled.resolve(specifier)).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
