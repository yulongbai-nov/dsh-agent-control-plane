# 失败取证 reporter（screenshot / video / GIF / trace）

`failure-evidence.mjs` 是 Playwright reporter：**任何测试失败**都会把该次的证据归档到

```
${DSH_E2E_ARTIFACTS}/failures/<runId>/<test-slug>/
├── failure.png       # 失败瞬间截图（screenshot: only-on-failure）
├── failure.webm      # 屏幕录制（video: retain-on-failure）
├── failure.gif       # 由 webm 转出的动图（本文件说明的转换链路）
├── trace.zip         # Playwright trace（trace: retain-on-failure）
├── error.txt         # 错误信息 + stack
└── evidence.json     # 机器可读索引（含 gif 状态/帧数/ffmpeg 路径），方便 CI 上传
```

`index.json` 汇总一次 run 的全部失败。reporter 自身永不抛错：GIF 不可用时只在
`evidence.json` 里记录 `gif.reason`，webm/trace 照常保留。

## 启用

`e2e/playwright.config.mjs` 已接好：

```js
reporter: [['list'], ['./reporters/failure-evidence.mjs']],
use: {
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
  trace: 'retain-on-failure',
},
```

`DSH_E2E_ARTIFACTS` 由 `run-e2e.mjs` 设置为当次 run 的 `screenshots/` 目录
（`/tmp/dsh-e2e/runs/run-<id>/screenshots`），因此 evidence 落在
`<run>/screenshots/failures/<runId>/<slug>/`，并随 run 结束一起复制到
`/tmp/dsh-e2e/artifacts/latest/`。CI 里直接上传 `artifacts/latest/failures/` 即可。

## 自检：故意失败一次，证明链路可用

```bash
DSH_E2E_SELF_FAIL=1 node e2e/run-e2e.mjs
```

`e2e/tests/99-self-check.spec.mjs` 只在该环境变量为 `1` 时执行并**故意失败**；
平时 skip，不影响正常套件。运行结束（退出码为 1 属预期）后：

```bash
find /tmp/dsh-e2e/artifacts/latest/failures -type f
```

应能看到 png / webm / gif / trace.zip 四类证据。

## GIF 转换链路（为什么不是一条 ffmpeg 命令）

优先顺序：

1. `$DSH_E2E_FFMPEG`（显式指定的完整 ffmpeg，CI 可自行安装）
2. Playwright 缓存自带的 ffmpeg：
   - macOS `~/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac`（旧版 `ffmpeg-mac-arm64` 也覆盖）
   - Linux `~/.cache/ms-playwright/ffmpeg-*/ffmpeg-linux`
   - Windows `%LOCALAPPDATA%\ms-playwright\ffmpeg-*\ffmpeg-win64.exe`
3. PATH 上的 `ffmpeg`（`which ffmpeg`）

如果找到的 ffmpeg 带 GIF encoder + `palettegen/paletteuse`（完整构建），直接一次转：
`-vf fps=25,scale=480:-2,split[a][b];[a]palettegen[p];[b][p]paletteuse -loop 0 out.gif`。

**注意**：Playwright 自带的 ffmpeg 是 `--disable-everything` 的最小构建（只有
VP9 解码/编码、PNG 编码、webm/image2 muxer，**没有 gif muxer 和 palette 滤镜**），
所以对它是两段式：

1. 用 Playwright 的 ffmpeg 把 webm 解成 PNG 帧
   （`scale=480:-2`，最多 180 帧）；
2. 用纯 JS 的 [`gifenc`](https://github.com/mattdesl/gifenc) 合成动图
   （最多 60 帧、480 宽、约 25fps 近似延时；帧序/像素已用独立 GIF 解析器校验）。

这样 CI 不需要系统 ffmpeg：Playwright 缓存 + `npm install` 即可产出 GIF。
若两者都不存在，则记录 `gif 不可用` 并保留 webm。

## 相关文件

- `reporters/failure-evidence.mjs` — Playwright reporter 本体
- `reporters/gif-from-webm.mjs` — ffmpeg 发现 / webm→PNG 帧 / PNG→GIF
- `tests/99-self-check.spec.mjs` — `DSH_E2E_SELF_FAIL=1` 的故意失败用例
- `playwright.config.mjs` — 取证开关与 reporter 注册
- `run-e2e.mjs` — 透传 `DSH_E2E_SELF_FAIL` / `DSH_E2E_RUN_ID` 并启动 Playwright

## CI 复用示例（GitHub Actions）

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with: { node-version: 24 }
- run: npm ci
  working-directory: e2e
- name: E2E（自检模式，故意失败一次以产生失败证据）
  run: DSH_E2E_SELF_FAIL=1 node e2e/run-e2e.mjs
  continue-on-error: true
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: e2e-failure-evidence
    path: /tmp/dsh-e2e/artifacts/latest/failures/
    if-no-files-found: ignore
```

宿主机需要：安装好 DSH 桌面版（`DSH_E2E_DSH_BIN` 可覆盖路径）、首次运行已登录的 `~/.dsh`
（真实凭据只用于真实模型层用例；默认套件零令牌消耗）、Playwright 浏览器与自带 ffmpeg 缓存
（`e2e` 目录 `npm ci` 后都会具备）。失败证据目录里的 `index.json` 可直接作为 CI 摘要来源。
