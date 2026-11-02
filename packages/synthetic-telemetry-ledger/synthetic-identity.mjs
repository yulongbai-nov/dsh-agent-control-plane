import { createHmac } from 'node:crypto';
import { types } from 'node:util';

// This research helper accepts synthetic fixtures only; it is not key management.
const fail = () => { throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' }); };
const fields = ['workspaceId','sessionId','sourceId','generationId'];
function capture(input) {
  if (!input || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input)) fail();
  const proto=Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) fail();
  const keys=Reflect.ownKeys(input);
  if (keys.length !== fields.length || keys.some(k => typeof k !== 'string' || !fields.includes(k))) fail();
  const out=Object.create(null);
  for (const field of fields) {
    const d=Object.getOwnPropertyDescriptor(input,field);
    if (!d || !Object.hasOwn(d,'value') || typeof d.value !== 'string' || d.value.length === 0 || d.value.length > 256 || !d.value.isWellFormed() || Buffer.byteLength(d.value,'utf8') > 256) fail();
    out[field]=d.value;
  }
  return out;
}
function frame(hash,value) {
  const bytes=Buffer.from(value,'utf8'), size=Buffer.alloc(4);
  size.writeUInt32BE(bytes.length); hash.update(size); hash.update(bytes);
}
function derive(key,label,parts) {
  const hash=createHmac('sha256',key);
  frame(hash,'dsh.synthetic-telemetry/v1'); frame(hash,label);
  for (const part of parts) frame(hash,part);
  return hash.digest('hex');
}
/** Produce distinct synthetic session and source-generation identities. */
export function deriveSyntheticIdentity(secretHex,input) {
  if (typeof secretHex !== 'string' || secretHex.length !== 64 || !/^[0-9a-f]{64}$/.test(secretHex)) fail();
  const v=capture(input), key=Buffer.from(secretHex,'hex');
  try {
    return {
      sessionKey:derive(key,'session',[v.workspaceId,v.sessionId]),
      sourceEpoch:derive(key,'source-generation',[v.workspaceId,v.sessionId,v.sourceId,v.generationId]),
    };
  } finally { key.fill(0); }
}
