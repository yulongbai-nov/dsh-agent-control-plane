# Task-derived title service — unsafe research WIP

**DO NOT INSTALL, RUN AGAINST REAL PROFILES, OR WRITE TO PERSISTENT USER SESSIONS.** This exploratory public-source patch introduces `source.kind = task` into a V4 `session/title` event. A synthetic JSONL test demonstrated that the current released V4 reader rejects that stored event as corrupt: `session/title messageSeqs must be empty exactly for a user title`. Applying this patch to an actual profile and submitting a task title can make its Session unreadable. A passing test count below includes an explicit expected-rejection test; it is evidence of incompatibility, not a persistence fix. No real app, profile, personal data or model was touched.

## Narrow experiment

Against public source commit `b830ec950faba0a46dda564be3e2d854afed94f1`, this WIP adds a synchronous `submitTaskTitle` seam to the existing single `SessionTitleService`, records explicit task provenance without inventing any user message, requires a trusted injected `taskTitleAuthority`, snapshots candidate fields, rejects current user pins, supersedes older provider work and refuses stale same-Lead task cuts. It rechecks cancellation, live Session, revision, user pin and authority around synchronous callbacks. Existing message provider registration is not replaced.

The authority in tests is a **synthetic mock**, not proof of actual Team ownership, authorization, complete task observation, or cross-log atomicity. There is no real task-event observer, no guaranteed ≤1-turn update, no cold-session task reconciliation, no mixed-process locking, and no production access control. The seam is public in the WIP and unsafe to expose. It assumes a well-behaved trusted verifier and does not guarantee behavior under arbitrary host reentrancy, mutable signal/Session objects or all races. Same-Lead event sequence is an experimental watermark, not proof of complete cross-session causality.

## Actual synthetic evidence

The full public-source `packages/session/session-title/tests` suite passed **56/56**, including eight WIP tests for mock authority absent, task source without fabricated human messages, user pin, already-aborted request, in-flight provider supersession, same-process title-service remount, verifier reentrancy, Proxy/getter rejection, V4 JSONL incompatibility and an ignorable plugin record. The exact test source is part of the patch; the suite includes existing tests. `tsc --noEmit -p packages/session/session-title/tsconfig.json` passed. Source and tests used Node 24.22.1, Vitest 4.1.11, isolated HOME/TMPDIR and synthetic session files; test teardown deletes its own temporary directories. These tests are not real GUI/Host transport E2E, a proven egress boundary, or a valid task-title disk restart.

The JSONL incompatibility test deliberately checks for the released reader's rejection. A separate synthetic test appends a namespaced `ignorable` plugin suggestion record after a **canonical user-pinned** title and successfully reopens the JSONL; the released-style canonical title fold remains the user pin and the plugin record is preserved. This supports a possible backwards-compatible **separate suggestion overlay** only. It does not show a real old installed binary, UI rendering, task authority, pin race across versions, crash recovery or complete R9.

Retained suite output: `work/title-evidence/vitest.log` SHA-256 `f0be3c8a711113abdbd34bb44cb3149c002d5b80ed37d2dd2e14fcb17fa45466`. `upstream.patch` SHA-256 `d2259c1cd6ff466ef9fa8a5a2b948eb689d84d534f948efc119564c41a19afe4`. It is a zero-context patch and passed `git apply --unidiff-zero --check` against the pinned public base. It is for inspection in an isolated test copy only.

| File | Pinned SHA-256 | WIP SHA-256 |
| --- | --- | --- |
| `packages/session/session-title/src/index.ts` | `1fc0c2d541d2f0139496591ebd09a3be0eb46fee67b86b9e87d7990866889411` | `593d3df34f70ed66e72c856ee9881a9ccd498fa7f971fbacea4d00f7012849f8` |
| `packages/session/session-title/src/types.ts` | `ebe56d55b99fd921e96b2829126bd10b3f352792a6d22dbc0bacd9909f4923f6` | `0aeeb22f059d060ceffff6d78e862a188cab4f5ba6ee3ace854452fc69aa6094` |
| `packages/session/session-title/tests/task-wip.spec.ts` | absent | `d530e0a0a731dca18fb3f5ed4bf8a67390373d5bd0b746593396f61d680272bf` |

## Format and rollback choices for review

1. **Compatible informational overlay:** an experimental namespaced ignorable plugin record may be retained by older V4 readers, which skip unfamiliar records and continue to show the last canonical title. New clients would need an explicitly separate suggestion projection and strict precedence over verified current task, later canonical pin, delete/reassignment, restart and authorization. This is not automatically a canonical title or R9 success. Old/new reader coexistence, preservation through migrations, old-client edits and loss of an ignorable record all need tests.
2. **Canonical title evolution:** if task-source title must be authoritative and older readers cannot safely interpret the nested discriminator, design a new format version/required event with forward migrations, validation of causal references, reader fail-closed before mutation, explicit minimum version and immutable pre-upgrade backup. Demonstrate rollback using a verified separate copy or a deliberate loss-aware export; do not silently rewrite an append-only log or invent a human message. Session `ignorable` applies to unknown event types, not arbitrary nested values in a known `session/title` payload.

Both choices require a real authorized task source, deterministic task selection, race/cancellation policy, user pin handling, cross-session watermarks, replay and crash consistency, concurrent writer fencing, version compatibility and recovery tests before any deployment. These are not implemented by this WIP.
