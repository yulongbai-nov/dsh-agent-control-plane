import { DatabaseSync } from 'node:sqlite';
import { constants, openSync, closeSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { types } from 'node:util';

// Research-only building block. This API cannot determine whether input is synthetic.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const key = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function ownFields(value, fields) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) fail('INVALID_INPUT');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail('INVALID_INPUT');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(k => typeof k !== 'string' || !fields.includes(k))) fail('INVALID_INPUT');
  const result = Object.create(null);
  for (const field of fields) {
    const d = Object.getOwnPropertyDescriptor(value, field);
    if (!d || !Object.hasOwn(d, 'value')) fail('INVALID_INPUT');
    result[field] = d.value;
  }
  return result;
}
function snapshot(input) {
  const v = ownFields(input, ['sessionKey', 'sourceEpoch', 'asOfSeq', 'outputTokens']);
  if (!key(v.sessionKey) || !key(v.sourceEpoch) || !Number.isSafeInteger(v.asOfSeq) || v.asOfSeq < 0 || Object.is(v.asOfSeq, -0) ||
      !(v.outputTokens === null || Number.isSafeInteger(v.outputTokens) && v.outputTokens >= 0 && !Object.is(v.outputTokens, -0))) fail('INVALID_INPUT');
  return v;
}
function identity(input) {
  const v = ownFields(input, ['sessionKey', 'sourceEpoch']);
  if (!key(v.sessionKey) || !key(v.sourceEpoch)) fail('INVALID_INPUT');
  return v;
}
function checkSchema(db, version) {
  const schema = db.prepare("SELECT type,name FROM sqlite_master WHERE lower(substr(name,1,7)) <> 'sqlite_' ORDER BY name").all();
  const names = version === 1 ? ['snapshots','tombstones'] : ['snapshots','source_cursors','tombstones'];
  if (JSON.stringify(schema.map(v => [v.type, v.name])) !== JSON.stringify(names.map(name => ['table',name]))) fail('UNSUPPORTED_SCHEMA');
  for (const table of names) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(v => [v.name,v.type,v.notnull,v.dflt_value,v.pk]);
    const expected = [['session_key','TEXT',0,null,1],['source_epoch','TEXT',1,null,0],['seq','INTEGER',1,null,0]];
    if (table === 'snapshots') expected.push(['output_tokens','INTEGER',0,null,0]);
    if (JSON.stringify(columns) !== JSON.stringify(expected)) fail('UNSUPPORTED_SCHEMA');
  }
}
function checkStoredRows(db, version) {
  const tables = version === 1 ? ['snapshots','tombstones'] : ['snapshots','source_cursors','tombstones'];
  for (const table of tables) {
    const invalid = `typeof(session_key) <> 'text' OR length(session_key) <> 64 OR length(CAST(session_key AS BLOB)) <> 64 OR session_key GLOB '*[^0-9a-f]*'
      OR typeof(source_epoch) <> 'text' OR length(source_epoch) <> 64 OR length(CAST(source_epoch AS BLOB)) <> 64 OR source_epoch GLOB '*[^0-9a-f]*'
      OR typeof(seq) <> 'integer' OR seq < 0 OR seq > 9007199254740991`;
    const output = table === 'snapshots' ? ` OR (output_tokens IS NOT NULL AND
      (typeof(output_tokens) <> 'integer' OR output_tokens < 0 OR output_tokens > 9007199254740991))` : '';
    if (db.prepare(`SELECT 1 FROM ${table} WHERE ${invalid}${output} LIMIT 1`).get()) fail('INVALID_STORED_DATA');
  }
}
function verifyDir(directory) {
  if (typeof directory !== 'string' || resolve(directory) !== directory || realpathSync(directory) !== directory) fail('UNSAFE_DIRECTORY');
  const d = lstatSync(directory);
  if (!d.isDirectory() || d.isSymbolicLink() || (d.mode & 0o777) !== 0o700 || (process.getuid && d.uid !== process.getuid())) fail('UNSAFE_DIRECTORY');
}
function ensureFile(path) {
  try {
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    closeSync(fd);
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || (st.mode & 0o777) !== 0o600 || (process.getuid && st.uid !== process.getuid())) fail('UNSAFE_FILE');
}
export function openSyntheticLedger(directory) {
  verifyDir(directory);
  const path = join(directory, 'ledger.sqlite');
  ensureFile(path);
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 1000');
    let version = db.prepare('PRAGMA user_version').get().user_version;
    if (version === 0) {
      db.exec('BEGIN IMMEDIATE');
      try {
        version = db.prepare('PRAGMA user_version').get().user_version;
        if (version === 0) {
          if (db.prepare("SELECT 1 FROM sqlite_master WHERE lower(substr(name,1,7)) <> 'sqlite_' LIMIT 1").get()) fail('UNSUPPORTED_SCHEMA');
          db.exec(`CREATE TABLE snapshots (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL, output_tokens INTEGER);
            CREATE TABLE tombstones (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL);
            PRAGMA user_version = 1;`);
          version = 1;
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    if (version === 1) {
      db.exec('BEGIN IMMEDIATE');
      try {
        version = db.prepare('PRAGMA user_version').get().user_version;
        if (version === 1) {
          checkSchema(db, version);
          checkStoredRows(db, version);
          if (db.prepare('SELECT 1 FROM snapshots s JOIN tombstones t ON s.session_key=t.session_key LIMIT 1').get()) fail('CURSOR_INCONSISTENT');
          db.exec(`CREATE TABLE source_cursors (session_key TEXT PRIMARY KEY, source_epoch TEXT NOT NULL, seq INTEGER NOT NULL);
            INSERT INTO source_cursors SELECT session_key,source_epoch,seq FROM snapshots;
            PRAGMA user_version = 2;`);
          version = 2;
        } else if (version !== 2) fail('UNSUPPORTED_SCHEMA');
        db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK'); throw e; }
    }
    if (version !== 2) fail('UNSUPPORTED_SCHEMA');
    checkSchema(db, version);
    checkStoredRows(db, version);
    if (db.prepare(`SELECT 1 FROM snapshots s LEFT JOIN source_cursors c ON s.session_key=c.session_key
      WHERE c.session_key IS NULL OR s.source_epoch<>c.source_epoch OR s.seq<>c.seq
      UNION ALL SELECT 1 FROM source_cursors c LEFT JOIN snapshots s ON s.session_key=c.session_key
      WHERE s.session_key IS NULL UNION ALL SELECT 1 FROM tombstones t JOIN snapshots s ON t.session_key=s.session_key LIMIT 1`).get()) fail('CURSOR_INCONSISTENT');
    const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const v = fn(); db.exec('COMMIT'); return v; } catch(e) { db.exec('ROLLBACK'); throw e; } };
    const writeOne = v => {
      if (db.prepare('SELECT 1 FROM tombstones WHERE session_key=?').get(v.sessionKey)) fail('TOMBSTONED');
      const old = db.prepare('SELECT source_epoch,seq,output_tokens FROM snapshots WHERE session_key=?').get(v.sessionKey);
      if (old) {
        if (old.source_epoch !== v.sourceEpoch) fail('SOURCE_EPOCH_CONFLICT');
        if (v.asOfSeq < old.seq) fail('STALE_SEQUENCE');
        if (v.asOfSeq === old.seq) {
          if (v.outputTokens !== old.output_tokens) fail('SEQUENCE_CONFLICT');
          return 'duplicate';
        }
      }
      db.prepare('INSERT INTO snapshots VALUES (?,?,?,?) ON CONFLICT(session_key) DO UPDATE SET source_epoch=excluded.source_epoch, seq=excluded.seq, output_tokens=excluded.output_tokens').run(v.sessionKey,v.sourceEpoch,v.asOfSeq,v.outputTokens);
      db.prepare('INSERT INTO source_cursors VALUES (?,?,?) ON CONFLICT(session_key) DO UPDATE SET source_epoch=excluded.source_epoch, seq=excluded.seq').run(v.sessionKey,v.sourceEpoch,v.asOfSeq);
      return 'stored';
    };
    return {
      ingest(input) {
        const v = snapshot(input);
        return tx(() => writeOne(v));
      },
      ingestBatch(inputs) {
        if (types.isProxy(inputs) || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) fail('INVALID_INPUT');
        const values = [];
        for (let i=0; i<inputs.length; i++) {
          const d = Object.getOwnPropertyDescriptor(inputs, String(i));
          if (!d || !Object.hasOwn(d, 'value')) fail('INVALID_INPUT');
          values.push(snapshot(d.value));
        }
        return tx(() => values.map(writeOne));
      },
      get(input) {
        const v = identity(input);
        const tombstone = db.prepare('SELECT source_epoch FROM tombstones WHERE session_key=?').get(v.sessionKey);
        if (tombstone) { if (tombstone.source_epoch !== v.sourceEpoch) fail('SOURCE_EPOCH_CONFLICT'); return { status: 'tombstoned' }; }
        const row = db.prepare('SELECT source_epoch,seq,output_tokens FROM snapshots WHERE session_key=?').get(v.sessionKey);
        if (!row) return { status:'unknown' };
        if (row.source_epoch !== v.sourceEpoch) fail('SOURCE_EPOCH_CONFLICT');
        return { status:'observed', asOfSeq:row.seq, outputTokens:row.output_tokens, durable:'unknown' };
      },
      clear(input) {
        const v = identity(input);
        return tx(() => {
          const tombstone = db.prepare('SELECT source_epoch FROM tombstones WHERE session_key=?').get(v.sessionKey);
          if (tombstone) { if (tombstone.source_epoch !== v.sourceEpoch) fail('SOURCE_EPOCH_CONFLICT'); return 'already-cleared'; }
          const old = db.prepare('SELECT source_epoch,seq FROM snapshots WHERE session_key=?').get(v.sessionKey);
          if (!old) fail('UNKNOWN_SESSION');
          if (old.source_epoch !== v.sourceEpoch) fail('SOURCE_EPOCH_CONFLICT');
          db.prepare('INSERT INTO tombstones VALUES (?,?,?)').run(v.sessionKey,old.source_epoch,old.seq);
          db.prepare('DELETE FROM source_cursors WHERE session_key=?').run(v.sessionKey);
          db.prepare('DELETE FROM snapshots WHERE session_key=?').run(v.sessionKey);
          return 'cleared';
        });
      },
      close() { db.close(); },
    };
  } catch (e) { db.close(); throw e; }
}
