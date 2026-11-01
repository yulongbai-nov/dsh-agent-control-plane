import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const runtime = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/runtime.json';
// Restrict display to a bounded ASCII version shape; matching rc.5 still never authorizes launch.
const safeVersion = value => typeof value === 'string' && value.length <= 64 &&
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(value);

export function readiness() {
  return {
    ready: false,
    blockers: [
      '用户文件：缺少经正反对抗验证的文件访问白名单及完整独立运行目录。',
      'Keychain：未证明安全进程无法读取用户 Keychain 或通过系统服务获取凭据。',
      '本地端口：未证明 OS 级 loopback-only 监听及对 0.0.0.0 等通配绑定的负向 canary，也未证明安全选端口、服务所有权及仅允许目标地址的浏览器出站策略。',
      '生命周期：尚无已验证的 managed job、浏览器/子进程退出与端口释放机制。',
      'fixture：未验证无需安装的 profile 组合、真实浏览器与假 provider/session 的完整接入。',
    ],
  };
}

export function evidenceSummary() {
  return { appVersion: '0.2.1-rc.5', serverStarted: false, browserStarted: false, profileCreated: false, e2eValidated: false, sandboxProvesIsolation: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = 2;
  let installedVersion;
  try {
    const manifest = JSON.parse(await readFile(runtime, 'utf8'));
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest) ||
        !safeVersion(manifest.desktopVersion)) {
      throw new Error('invalid desktop version');
    }
    installedVersion = manifest.desktopVersion;
  } catch {
    // Error properties can contain control characters, secrets, or throwing getters.
    console.error('无法读取安装版元数据或版本格式无效。');
    process.exitCode = 2;
  }
  if (installedVersion !== undefined) {
    const status = readiness();
    console.log(`只读评估：安装版 ${installedVersion}，预期 0.2.1-rc.5；未启动服务或浏览器。`);
    for (const blocker of status.blockers) console.log(`未解决：${blocker}`);
    process.exitCode = installedVersion === evidenceSummary().appVersion ? 1 : 2;
  }
}
