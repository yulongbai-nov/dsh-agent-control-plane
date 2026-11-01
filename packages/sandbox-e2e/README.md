# rc.5 真实 GUI E2E：安全方案（尚不能运行）

**状态：未启动服务或浏览器、未创建隔离 profile、没有通过真实 E2E。** `preflight.mjs` 是只读阻断报告，不是隔离器或启动器：它读取安装版固定 `runtime.json` 的版本并列出尚未证明的条件；不读取用户会话、凭据或 profile、不写配置、不监听端口、不调用浏览器。条件未完成时有意返回退出码 1，安装元数据缺失或版本不匹配时返回 2。

```sh
cd packages/sandbox-e2e
npm test
node preflight.mjs                 # 当前预期退出码 1，表示安全条件不足
```

`node --check preflight.mjs && npm test` 包含真实 CLI 子进程测试，覆盖缺失、非字符串或空白版本、非法 JSON、读取失败、版本不匹配（退出码 2），以及精确 rc.5 的阻断报告（退出码 1）。测试只验证**设计状态不会误报可运行**；不证明沙盒、安全性、Web UI 或验收通过。

## 只读调研结论和必须避免的命令

证据为本机 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/` 下的已安装 rc.5 文档和实现，使用 Electron ASAR 读取；以下路径是归档内模块：

- `dsh-home-paths/README.zh.md:29–56`、`lib/index.js:101–124`：`DSH_HOME`、`DSH_AGENTS_HOME` 独立；空值会回退。`HOME`、`XDG_*`、`TMPDIR` 及进程启动目录也须隔离，且必须从**明确的 allowlist** 构建环境，不能继承原有 API key、代理、DSH、凭据、Node 注入、Chrome 配置变量。
- `dsh-app-boot/README.zh.md:45–67,132–140`、`lib/index.js:611–645`：profile 内部、home 和调用目录的配置/环境都可影响组合；加载旧 `.dsh-module-fallback` 时会删除其投影。新的隔离目录必须实为新目录且没有 symlink/hardlink 或不可信 patch，避免指向用户文件。只换 profile 名不够。
- `dsh/lib/profile-boot-C14i-8IN.js:129–180`：`--from-default-profile` 会替换同名 profile 并在某些路径调用 `rmSync`，所以本任务**禁止**该选项；`dsh plugin` 会调用包管理器，**禁止**安装或修改现有 profile。
- `dsh-base/cordis.patch.yml:109–126,136–143,202–225`：默认存在凭据链、以 DSH_HOME 为基础的持久 session 和 telemetry；web 组合还含 product telemetry、定时任务与丰富工具（`dsh-web-app/cordis.patch.yml:38–55,135–140`）。即使测试本身没有显式模型请求，默认组合不可当作无副作用。需审阅每个激活条目、禁用会访问真实 credential/网络/外部进程者，提供只处理固定 fixture 的内存 fake provider。
- `dsh-web-app/lib/startup.js:24–25,44–68` 和 `dsh-host-webserver/lib/index.js:468–473`：可以 `--host 127.0.0.1 --port 0 --no-open` 由 OS 选空闲端口，不能用公开监听地址；实际网址从受控启动回执获取，不从既有 50359 推断。
- `dsh-web-app/lib/index.js:145–162`：启动日志的 authenticated URL 含进程 token；不能将 token 写日志、截图、任务板或转发给其他会话。不得连接既有 `http://127.0.0.1:50359`。

## 已进行的无服务策略探测（非完整隔离证明）

只用本机 `/usr/bin/sandbox-exec` 和 Node 做了短进程探测（其中一项曾在单个前台探针内创建临时 loopback listener，收到测试消息后随进程关闭）；没有启动 DSH、GUI、浏览器或持久后台 listener。出站测试只指定 [TEST-NET-3](https://datatracker.ietf.org/doc/html/rfc5737) 的 `203.0.113.7`，本机策略在尝试出站时返回 EPERM；没有收到外部响应。以下例子包含可观察的实验输入，**不是经过批准的生产沙盒配置**：

```sh
env -i PATH=/usr/bin:/bin HOME=/nonexistent \
  /usr/bin/sandbox-exec \
  -p '(version 1) (allow default) (deny network*) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:1"))' \
  /opt/homebrew/opt/node@24/bin/node --input-type=module <<'NODE'
import net from 'node:net';
for (const [host, port] of [['127.0.0.1', 1], ['127.0.0.1', 2], ['203.0.113.7', 443]]) {
  await new Promise((resolve) => {
    const s = net.connect({ host, port });
    s.setTimeout(1000, () => { console.log(host, port, 'TIMEOUT'); s.destroy(); resolve(); });
    s.on('error', (error) => { console.log(host, port, error.code); resolve(); });
  });
}
NODE
```

本机结果依次为 `ECONNREFUSED`、`EPERM`、`EPERM`；第一个允许连接但本机无监听者，后两者被系统拒绝。`localhost:*` 会允许本机所有服务，不得用于待测客户端；按 port 单独放行仍需验证精确地址族、DNS/Unix socket、目标服务所有权、浏览器子进程继承和从端口公布到浏览器启动的竞态。此处没有在固定端口上启动服务；**不能把这一探测当作生产安全策略**。

另一个仅针对 `/Users/yulong` 的 `(deny file-read* file-write* (subpath ...))` 可令该路径下 stat 返回 EPERM，但 `/private/tmp`、`/private/var/folders` 与 `/Users/Shared` 仍可读；它不能防其他用户/临时文件或进程间 IPC。`(deny default)` 的初次 Node 探测以 signal 6 终止，未诊断，不表明默认拒绝不可实现。策略还必须涵盖软/硬链接和所有读取/写入/进程间访问路径；仅改环境变量不是权限隔离。

**Keychain 负例：**在拒绝 `/Users/yulong` 文件访问且拒绝 `mach-lookup` 到 `com.apple.securityd` 后，运行 `/usr/bin/security list-keychains -d user` 仍以 0 退出。测试丢弃 stdout、只记录退出状态，未尝试读取、打印或发送任何凭据。成功列举 API 本身不证明秘密可以读取，但也不能以该规则声称隔离成功。需在专用临时账号/虚拟机创建**合成凭据 canary**，对完整进程树证明不可读取、且正向对照有效；不能对用户实际 Keychain 做试探。

## 进入真实 E2E 的门槛

下面是设计要求，不是可运行脚本；每项都必须有真实、可重现的正反测试和审核：

1. **文件与身份边界：**使用专用隔离系统账号或虚拟机；若只能用本机 sandbox，则先完成 default-deny 白名单，读取仅限已审查安装 runtime、只读测试插件和必要系统库，写入仅限仓库下新建且隔离的专属工作目录（及经过审查的不可变系统设备）。隔离 `HOME`、`DSH_HOME`、`DSH_AGENTS_HOME`、XDG、临时目录、cwd、浏览器 user-data，清空继承环境；证明包含子进程的真实 user HOME、共享目录和合成 canary 全部被拒绝，且无法访问用户 keychain、其他 IPC；不得删除任何用户文件。
2. **网络与监听：**宿主启动时只允许在 `127.0.0.1:0` 绑定，禁所有出站；若产品实际需要回连或 Unix socket，在隔离层明确最小白名单并实测。获取并验证准确 URL、进程身份和监听 socket 所有者之后，才以**精确目的端口**的独立策略启动浏览器；断言访问当前 GUI 50359 及其他 localhost/外网均被拒绝。端口关闭/重用/进程替换必须中止，不能自动连接未知服务。
3. **进程生命周期：**通过工具的 managed background job 启动，严格限定 timeout，保留 job id；处理正常退出、异常、测试失败、终止、启动失败，回收浏览器、子进程和 server；最后验证端口释放。不能在后台留进程；不自动删除隔离目录或用户任何文件。
4. **fixture 和组装：**本地独立 workspace、最小离线 profile、审查的 session-tree bundle 和固定测试数据，fake provider 只接收测试数据。证明 rc.5 profile resolver、Host API、认证、客户端依赖和 session catalog 全链启动，无网络或真实凭据，且不依赖 `--from-default-profile` 的替换路径及联网安装。静态页面、内存 SessionStore 或假装 DOM 不是 E2E。
5. **验收及证据：**使用同一隔离浏览器真实加载 server 提供的地址，验证页面、插件加载、树展开、模拟 fixture 导航、locale、键盘和浅/深色（R17）；输出不含 token、用户路径/隐私的日志和截图。现有 app 窗口与 profile 保持不变。只有这些实际完成才可称 GUI 端到端；具体 R7 仍需对照其侧栏位置要求。

当前这五项均未被证明，不运行服务或浏览器。已有的 [`sandbox-smoke`](../sandbox-smoke/README.md) 是真实 rc.5 服务与模拟客户端环境的内存集成，不应冒充上述验收。
