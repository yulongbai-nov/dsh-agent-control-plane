# Synthetic utility research — non-installable WIP

This is a fixture-only experiment against public upstream commit `b830ec950faba0a46dda564be3e2d854afed94f1`, lockfile SHA-256 `911b049924e8256d8d6e684235cf935ca75b28fd0dd46f0c3b316a51c2cf5dc1`. It registers the stable `run_utility` name in the genuine ToolRuntime but executes only injected inert synthetic functions. It does **not** run the real workflow engine, call a model, or establish E2E coverage.

Manual confirmation is a trusted test callback, not an authenticated human approval. State and deduplication are process-local; there is no durable registry, source authenticity, principal/workspace authorization, input schema registry, isolation, resource limits, durable idempotency, cross-process concurrency control, or revocation of running work. Do not use this with personal data, real credentials, untrusted code, or the installed app. Safe production integration is blocked on these requirements, including approved immutable source and a Host-owned approval bound to the intended action. A denial or crash during real execution can have an unknown outcome; no automatic retry guarantee is made here.

## Observed evidence

- Registry test: 3/3 passed, `registry-test.log`, SHA-256 `d381b608cfb355672ea66623f622382d35f2ba61d2b584a8f74a98536f5a7282`.
- Synthetic Host ToolRuntime test: 1/1 passed, `host-test.log`, SHA-256 `1688d8e5bb4cf5c64202394c55035a245449c085448793a9954b614ce484fe5a`. This uses registered tool dispatch, fixture-only versions, simulated confirmation, disable/rollback, and in-memory duplicate suppression. macOS sandbox denied networking and excluded personal app/profile paths; this is not evidence of native workflow execution or real authorization.
- Test input hashes: `registry.mjs` `4c68d509be563695ac1e29933bafa3798bb8d51d4211850871750edda8cf5215`; `registry.test.mjs` `3f724070a75ede5c98959d8a310ea7ee2133aebe2f015673e1e48ec59c850c0c`; `host-tool.ts` `84c7746633eec7b2b893d1c45d8011fe756d54be29e50d2473f187bc05f2fe46`; `host-tool.spec.ts` `c5845d28307331af6762ba1fe53afd573283b8c81c1753ee3126ecf7e0167c99`. These were independently hashed after the run; no pre-run hash manifest was retained.

## Reproduction

In an isolated checkout of the exact upstream commit, prepare dependencies from the frozen lockfile with pnpm 11.28.5 and scripts and pnpmfile hooks disabled; do not use a real DSH installation. Copy `registry.mjs`, `registry.test.mjs`, and `host-tool.ts` to `synthetic-utility-wip/` at the checkout root, and copy `host-tool.spec.ts` to `packages/core/tools/tests/synthetic-utility-wip.host.spec.ts`. The test import expects exactly these paths.

Run `node --test synthetic-utility-wip/registry.test.mjs`. For the Host test use `node node_modules/vitest/vitest.mjs run packages/core/tools/tests/synthetic-utility-wip.host.spec.ts --no-file-parallelism --reporter=verbose` in an appropriate network-denying sandbox with profile and installed-app access excluded. `observed-sandbox-command.sh` preserves the exact command used on this machine, including absolute paths; inspect and adjust paths for a different environment. It is an evidence record, not an install script. Pin and review the toolchain and transitive dependencies independently before relying on another run.
