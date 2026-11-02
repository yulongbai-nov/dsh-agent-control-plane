# Team member selection — pinned-source WIP

**Research patch, not a deployable release or R1–R6 acceptance.** `upstream.patch` targets public DeepSeek Harness source commit `b830ec950faba0a46dda564be3e2d854afed94f1`, not the installed app. It changes only `experimental/agent-team` Host request types, roster logic and existing Team tests. It has not been installed, exposed through the model-facing Team tool, exercised in a GUI, reviewed for production, or verified equivalent to the installed rc.5 Host artifact.

The patch accepts optional per-member `agentOptions` and `agentPreset`, snapshots a closed set of option fields before Team journal admission, and passes them to the existing `startActivation` request. The native subagent provider's capability check rejects unsupported fields; the Team journal still records a failed provisioning edge for a backend capability error. Unknown option keys are rejected before creating a roster entry. This is not a policy grant: provider/model selection must still be authorized and route-preflighted before any user-facing entry point is exposed.

## Reproduction and test boundary

1. Obtain the exact **public source** at the commit above in an isolated working copy, review the diff and verify the three input hashes below. The patch has zero context: use `git apply --unidiff-zero --check <absolute-patch-path>` and, only after reviewing the result and confirming the hashes, `git apply --unidiff-zero <absolute-patch-path>`. Zero-context application relies on the exact file hashes, not nearby lines; never apply it to other versions, an installed app or a user profile. The patch was applied to fresh copies of the three pinned files and produced exactly the patched hashes below.
2. Prepare the pinned lockfile's reviewed dependency closure and Node 24, without inheriting credentials or reading real DSH config. The local test used Node `v24.22.1` and Vitest `4.1.11` from the prepared workspace. Dependency provenance and source equivalence to installed rc.5 were not established.
3. The genuine synthetic Host suite uses JSONL session persistence and the native POSIX flock addon. The local addon was built **in the isolated source copy** with `node native/system/scripts/build.ts --host-addon-only`, using the local Node headers and Apple compiler. Its output SHA-256 was `9534cde445a865250eb7bc8cfe5e231f3f91d0fda3f4aaa694e81f3531ad1130`; build output may differ on another machine. The build script temporarily creates and removes its own `.release/native-build-*` directory and writes the ignored host-specific addon under `native/system/packages/darwin-arm64/bin/`.
4. Use a freshly created task-owned empty HOME and TMPDIR under the isolated working area, an environment allowlist such as PATH/HOME/TMPDIR/NO_COLOR only, and run the single Team suite with `node_modules/.bin/vitest run packages/experimental/agent-team/tests/team.spec.ts`; then `node_modules/.bin/tsc --noEmit -p packages/experimental/agent-team/tsconfig.json`. The suite uses mock model adapters, creates synthetic session JSONL directories under TMPDIR, and its own `afterEach` recursively removes those directories. It does not intentionally start the real DSH service, browser, model or network; this is not a verified operating-system network boundary. Review the exact test and its cleanup before running.

On this machine the full selected Team suite passed **50/50**, including six new tests: actual live synthetic child route options; independent fresh preset recorded in the child; fork preset capability rejection; unknown fields rejected before provisioning; a fake backend lacking route capability rejecting without invocation; and request/options Proxy, revoked Proxy and accessor rejection without trap execution or provisioning. Existing Team tests use ordinary request literals and passed. TypeScript source check passed. An initial attempt failed because the native addon was missing; running `tsx` to build it also hit sandbox denial of a local Unix socket, so the reviewed TypeScript build script was instead run directly with Node 24. These tests are not real browser/Host transport E2E and do not cover tool/GUI selection, external model routes or all providers.

## Exact file fingerprints

SHA-256, original pinned source → patched working copy:

| File | Original | Patched |
| --- | --- | --- |
| `packages/experimental/agent-team/src/types.ts` | `0537a77c061605b878e5fd6520fc5f363a2f12ab570650ddce7084b5436fbbbd` | `c24ddf276ddd72fcd44c8a1a573bfab7a8920318cb3f3943e06be51336ff198e` |
| `packages/experimental/agent-team/src/roster.ts` | `29cd1662e69b00eba7175b2b6f0568e918af887992b732c9d2d7656b2ce6c60b` | `8d40cb84907c0fc39847dc826de9d8749faf1aa21707e42931f7bf884f9c0b8b` |
| `packages/experimental/agent-team/tests/team.spec.ts` | `9545cdd8935399208da208815b39dd2494eb4bf633d1bab8f61608e612843f96` | `e6a3065bb5b6867d5306e46b73c96dd334f4452e1ed4d4cab0ee2a84f818c6a0` |

`upstream.patch` SHA-256: `c502ae5b1eeebce61ec3a37cfc66232eb97661adba6814b43eeeb9ee350ed8b4`.

## Remaining blockers

- R1/R2 recursive and team-wide depth budgeting, cross-entry admission, atomic concurrency and durable authorization remain unimplemented. This patch does not add depth enforcement.
- Host caller authority, selected-provider/model/effort authorization and exact-route preflight require a separate design; TypeScript types and provider capability checks do not prove permission or model compatibility. Existing provider capability checks happen after the provisioning edge.
- No model-facing `spawn_teammate` schema or UI exposes these fields. Do not wire them up until the preceding authorization and preflight are implemented and tested.
- Preset revision identity and cold-resume behavior, persisted selection semantics, restart races, multi-process coordination, archive/send gates and installed runtime compatibility are not established.
- Input validation is a narrow source WIP and must receive independent review, including proxies, accessors, serialization, size limits and cross-realm values, before production use.

### Input review findings

The implementation now uses Node `util.types.isProxy` before prototype or descriptor inspection, rejecting even revoked Proxy request and options envelopes without invoking traps. It snapshots only allowed own data descriptors, requires all existing request fields as own data properties, and rejects getters, symbols, inherited fields and unknown envelope keys before journal admission. It copies primitive values from four option properties before awaiting the Team journal. The existing ordinary request-literal Host suite passes, but external callers relying on custom prototypes, inherited fields, accessors or additional metadata will now be rejected and require compatibility review. This is not a hostile-object security boundary for nested `prompt` content, `signal`, mutable host objects, poisoned globals or downstream providers; those are not deeply inspected or cloned. Ordinary cross-realm objects are rejected. The 200-character limit measures JavaScript code units rather than UTF-8 bytes, and a nonempty preset containing surrounding whitespace is accepted as-is and may fail downstream. The open `AgentOptions` type is narrowed to four fields, so future extension fields fail closed. Preserve these limits in review; do not expose this to model or external inputs without a defined trust boundary and further adversarial tests.
