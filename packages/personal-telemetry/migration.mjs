import { DatabaseSync } from 'node:sqlite';

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

// Internal migration seam accepts an isolated in-memory handle only.
export function migrate(database) {
  if (!(database instanceof DatabaseSync)) fail('UNSUPPORTED_STORAGE', 'An in-memory node:sqlite database is required');
  const attached = database.prepare('PRAGMA database_list').all();
  if (attached.length !== 1 || attached[0].name !== 'main' || attached[0].file !== '') fail('UNSUPPORTED_STORAGE', 'Only an isolated in-memory database is supported');
  database.exec('BEGIN IMMEDIATE');
  try {
    const version = database.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) fail('UNSUPPORTED_SCHEMA', `Unsupported schema version: ${version}`);
    if (version === 0) {
      if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get()) fail('UNSUPPORTED_SCHEMA', 'Unversioned database is not empty');
      database.exec(`CREATE TABLE session_snapshots (
        session_key TEXT PRIMARY KEY NOT NULL,
        source_identity TEXT NOT NULL,
        as_of_seq INTEGER NOT NULL,
        uncachedInputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheWriteTokens INTEGER,
        turns INTEGER, steps INTEGER, llmMs REAL, toolMs REAL, ttftMs REAL, ttftSteps INTEGER, decodeMs REAL, decodeTokens REAL,
        freshness TEXT NOT NULL CHECK (freshness = 'unknown')
      ) STRICT`);
      database.exec('PRAGMA user_version = 1');
    }
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
