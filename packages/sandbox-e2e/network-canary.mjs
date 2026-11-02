// Synthetic listening test only: neither probe connects to any service.
// A passing result is not proof of guest, child-process, outbound or E2E isolation.
import net from 'node:net';
import { pathToFileURL } from 'node:url';

function listenProbe(host, createServer, timeoutMs) {
  return new Promise(resolve => {
    let server, timer, finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    try {
      server = createServer();
      timer = setTimeout(() => {
        try { server.close(); } catch {}
        finish({ outcome: 'unknown' });
      }, timeoutMs);
      server.once('error', error => finish({ outcome: 'error', code: typeof error?.code === 'string' ? error.code : '' }));
      server.listen({ host, port: 0, exclusive: true }, () => {
        // Never report success before the temporary listener is closed.
        try { server.close(error => finish(error ? { outcome: 'unknown' } : { outcome: 'listened' })); }
        catch { finish({ outcome: 'unknown' }); }
      });
    } catch { finish({ outcome: 'unknown' }); }
  });
}

export async function networkCanary({ createServer = () => net.createServer(), timeoutMs = 3000 } = {}) {
  const loopback = await listenProbe('127.0.0.1', createServer, timeoutMs);
  if (loopback.outcome !== 'listened') return { status: 'BLOCKED', loopback: 'not-proven', wildcard: 'not-run', ready: false };
  const wildcard = await listenProbe('0.0.0.0', createServer, timeoutMs);
  if (wildcard.outcome === 'listened') return { status: 'FAIL', loopback: 'allowed', wildcard: 'allowed', ready: false };
  if (wildcard.outcome === 'error' && ['EPERM', 'EACCES'].includes(wildcard.code)) {
    return { status: 'PASS', loopback: 'allowed', wildcard: 'denied', ready: false };
  }
  return { status: 'BLOCKED', loopback: 'allowed', wildcard: 'unknown', ready: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await networkCanary();
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2;
}
