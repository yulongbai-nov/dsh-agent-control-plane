# Synthetic workflow accumulator (research only)

**Not a DSH plugin, source verifier, authorization service, or R15 implementation.** This bounded in-memory fixture explores deduplication and unknown propagation; it does not read sessions, run workflows, use models, persist data, or access the network. Its fixture issuer is owned by the caller and can mint arbitrary claims, so neither a token nor an ID is proof of a real Host event. Do not pass real data.

A test harness supplies an exact non-empty list of up to 32 `fixture-` run IDs for one fixture workspace/workflow and issues branded receipt tokens with synthetic session, generation, run, attempt, source sequence bounds and outcome. The reader rejects forged or other-instance tokens. A seal prevents further issuance; all issued tokens must be observed and every planned run represented before any fixture counts are returned. Replays are idempotent; conflicting run identities/generations, attempt reuse, repeated source event positions, unexpected scopes/runs, or capacity overflow poison the fixture and force `UNKNOWN`. Results and counts are frozen and do not expose source IDs. Token issuance and seal are **test harness assertions**, not evidence of a complete real corpus.

Even a `COMPLETE_IN_FIXTURE` result always has `productionStatus: UNKNOWN`, `durability: UNKNOWN`, and `tokenAttribution: UNKNOWN`. It cannot infer trusted raw-event-to-tool-attempt-to-run/job ownership, engine-consumed accepted source, authorizations, a durable log cut or complete history. Native run IDs are generated in the workflow engine, and per-run agent seqs pair child events; neither proves source/attempt attribution. Parent recorder entries can be incomplete, and native run-start has no tool-call ID. A changed generation, fork inheritance, reused/continuable child totals, or overlapping work must not be made into token attribution or a real verdict by this module. This intentionally limited fixture accepts at most one claimed attempt per run and one run per attempt; unsupported or ambiguous mappings stay unknown, not interpreted as impossible native behavior.

There is no storage, crash recovery, watch invalidation, registry, cross-process trust, key management, R18 integration, Host API, Remote exposure, production authorization, recommendation, or UI. The fixture is not a security boundary: anyone holding the issuer can mint claims, and same-process code can alter intrinsic behavior. Existing snapshots are point-in-time and cannot be revoked. Never wire it into actual query, telemetry, or promotion paths.

Run with synthetic fixtures only:

```sh
node --test packages/workflow-synthetic-accumulator/test/*.test.mjs
```
