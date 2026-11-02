# WorkspaceBrowser with pinned primitives: research evidence

Nondeployable integration experiment. The production `WorkspaceBrowser` client bundle is the earlier combined R7 WIP from the disposable pinned upstream checkout, SHA-256 `96112116563328207bb8c08e344a0ef2a9c7e3572a5f4730838c8ff2ae9e109a`. The pinned baseline is upstream `b830ec950faba0a46dda564be3e2d854afed94f1`; its ui-primitives package source is unmodified in this checkout. The package was built from its compiled TypeScript with its own `tsdown.config.ts`, yielding static-linked `lib/index.js` SHA-256 `6e52c633c75e408d79d01754606aa7bd2f470eff720197862fb9f777076867a7`. This is an observed build, not a proof of installed app equivalence.

`build.cjs` SHA-256 `d29b805572b468712c9deb6db0eee9d83494890853af2dbe5e84b242ecef5c45` reads and verifies both input hashes, derives the 37 primitive imports used by the WorkspaceBrowser bundle and creates a test-only adapter using locally installed esbuild 0.28.1. It compiles actual imported CSS with lightningcss `[hash]_[local]` and injects it into the browser. The resulting adapter SHA-256 was `2f9baff081ae2fcdc53c60f9506b12a007c4fee8e03dd038943987bb8804cd88`. The generated adapter and metafile are intentionally not committed. The adapter includes additional package code because the original static entry has side effects: the locally retained `metafile.json` records 342 dependency input files (including shiki and katex); this is not a minimal dependency claim. The shell's actual module compiler is not used, and CSS hashing embeds checkout paths, so byte-for-byte reproduction at another path is not guaranteed. No packages were installed for this test.

`workspace-primitives.integration.cjs` SHA-256 `bc84ef099c6cf2841e72c957be76ea0495f827cff7ffda475e643b70f1dbc111` uses the actual built primitive components and CSS with pinned rc.5 production React asset SHA-256 `0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0`. It loads pinned `packages/client/ui-theme/src/styles/design-platform.css`, SHA-256 `809b20ae477324fdf5181a2d338655a19919cabbf1b0e60adc149908462c5a66`; the native theme toggles via `body[data-ds-dark-theme]`. The entire suite passed once in each mode: native watermark/overflow, grouped/flat, search, keyboard and Chromium AX ownership, access warning, dismissal, focus and scoped lineage behavior. The test confirms real CSS was injected, checks that theme background changes, and rejects unexpected page requests and page errors. It does not establish visual fidelity or contrast compliance.

Reproduce using the already verified pinned build checkout with its offline dependencies and generated TypeScript; run with isolated HOME/TMPDIR and restricted PATH. Paths below are placeholders, not commands to install or modify a user profile:

```sh
cd "$UPSTREAM/packages/client/ui-primitives"
node ../../../node_modules/tsdown/dist/run.mjs --config tsdown.config.ts --config-loader native
cd "$RESEARCH/primitives-browser"
R7_UPSTREAM="$UPSTREAM" node build.cjs
for mode in light dark; do
  PLAYWRIGHT_PATH="$PLAYWRIGHT" CHROMIUM_PATH="$CHROMIUM" \
  REACT_BUNDLE_PATH="$REACT_ASSET" R7_BUNDLE_PATH="$UPSTREAM/packages/client/ui-workspace/lib/client.js" \
  R7_PRIMITIVES_PATH="$PWD/primitives.cjs" R7_THEME_PATH="$UPSTREAM/packages/client/ui-theme/src/styles/design-platform.css" \
  R7_THEME_MODE="$mode" node workspace-primitives.integration.cjs
done
```

The actual run used a fresh Chromium context, route abort for all page requests, `--disable-background-networking` and host resolver denial. macOS required reviewed sandbox escalation for Chromium startup. Logs `../evidence/ui-primitives-tsdown.log`, `../evidence/primitives-adapter-build.log`, `../evidence/primitives-browser-modes.log` are local evidence and may contain local paths: do not commit them. Host data, React hooks/stores, slots, navigation callbacks, module registry and service adapters remain synthetic. This test does not exercise the actual DSH shell, real Host transport, profile, screen reader, network isolation, installed package compatibility, or live LLM.
