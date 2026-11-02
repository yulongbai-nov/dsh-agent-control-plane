# Synthetic persistent telemetry ledger (research only)

This is an isolated, **synthetic-data-only prototype**, not a DSH plugin or a production R18 implementation. Its API cannot determine whether supplied data is synthetic. Do not connect it to real sessions, profiles, credentials, analytics, Remote, or model-visible tools.

It stores one optional `outputTokens` count per opaque 64-hex session key and source epoch, with a caller-provided observed sequence. Missing counts are `null`, not zero. A repeat with the same sequence and value is idempotent; conflicting values, sequence regression, or an epoch change fail closed. `ingestBatch` accepts 1–100 synthetic snapshots and commits all snapshots and their matching source-epoch/observed-cursor rows in a single SQLite transaction. A conflict or invalid member leaves the whole batch unchanged. Schema v1 is checked and migrated transactionally to v2, deriving observed cursors from its synthetic snapshots; contradictory preexisting state is rejected. Sequences are *observations*, not evidence of durable source history or completeness. A clear transaction writes a tombstone and deletes the snapshot; every later replay or new epoch for that identity is rejected. This is a deliberately conservative synthetic policy, not an approved production deletion or generation policy. SQLite commit does not establish atomicity with any external event source.

The caller must provide an existing owner-only `0700` real directory. The prototype creates `ledger.sqlite` at `0600`, rejects symlinks, hard links, unsafe modes and unrecognized schema, and never exports or sends data. Initial file and path checks do **not** eliminate time-of-check/time-of-use races; no hostile filesystem safety guarantee is claimed. Logical deletion does not securely erase journal pages, filesystem snapshots, backups, or exports. This code uses synchronous `DatabaseSync`, has no worker or verified nonblocking integration, no authorization, no HMAC identity/key lifecycle, no authenticated source generation, actual-source cursor verification, or durable-cut proof, no actual backfill, no retention policy, and no production migration, export or UI. None of the R18 E2E acceptance requirements are claimed as complete.

Run only with disposable synthetic data in a dedicated directory:

```sh
node --test packages/synthetic-telemetry-ledger/test/*.test.mjs
```

Tests retain temporary synthetic databases for inspection. Set `TMPDIR` to a dedicated disposable test directory if desired. No files are automatically deleted.
