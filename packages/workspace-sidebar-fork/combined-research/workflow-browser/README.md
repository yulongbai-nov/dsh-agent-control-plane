# Workflow board / native panel browser experiment

This is nondeployable research against the isolated pinned public upstream checkout `b830ec950faba0a46dda564be3e2d854afed94f1`, not a DSH plugin registration or E2E test. The generated fixture, primitive bundle, and metafile are retained in the task workspace and are not committed. `fixture.cjs` (SHA-256 `42ced057762a2f2e98aa9ee866f738b487512e877f86838edb75272b2617300f`) injects local Acorn 8.18.0 into the actual `workflow-topology` parser and `workflow-board-projection` reducer. It parses a synthetic script as data, checks repeated topology/layout equality, parallel edges, literal pipeline expansion and unknown dynamic pipeline without invented edges; the script is never executed. It creates synthetic unverified, explicitly caller-asserted verified, conflicting, missing and out-of-order event inputs. Verified is only a synthetic caller assertion, not proof of real provenance.

`workflow.integration.cjs` (SHA-256 `6c41429f42c9aed7c39a753d99a03f4f81dc9ae697634bc56afddf5233ca3eb9`) renders the actual experimental `workflow-board-client` in production rc.5 React and Chromium. It separately renders the pinned upstream `WorkflowRunPanel` with real pinned primitives; the board is not actually mounted inside that panel or registered in a native slot. It checks stable node geometry after event overlays, keyboard graph→table and table→graph selection, status/model/phase filters and same-run phase retention, unverified navigation disabled, conflicting/missing/out-of-order events never painted completed, and a native panel direct-parent navigation callback using synthetic session identities. Requests are aborted and unexpected requests/page errors fail. The browser test passed; log `../evidence/workflow-browser.log` is local and can contain paths, not for commit.

The actual source files are hash-checked: topology `628b11587888b6ea0f467d773fdc6ddf1b5978292d6e3ddefcc97c8f0dec8313`, projection `b37bb9f08efd971f3ba153873e541dde3ca0da29151a72755dac14fa346c20ed`, board `875c91cd86b92f1654a7b4d0feca9c81528a0dab015d2a3074cbcf010f9adaee`. The compiled native workflow bundle is SHA-256 `70a709aaecf3e177fd7ba372e98a9bba1ca42f6d6ad213b5413d63a1e462dbda`; pinned ui-primitives static bundle is `6e52c633c75e408d79d01754606aa7bd2f470eff720197862fb9f777076867a7`. `build.cjs` (SHA-256 `d2536b5fd038e6c890b41b6cbe3cae2c02f90f24e9ec17a06adcede014862aea`) uses esbuild 0.28.1 and lightningcss to adapt the actual primitive bundle and styles for this synthetic harness; resulting `primitives.cjs` SHA-256 `7ad71baaf062dcb0672667cec2094e662b46aded048582f9399112592454fc9d`. This is not the native shell's module loader; output embeds local paths and may differ elsewhere. Native theme CSS SHA-256 `809b20ae477324fdf5181a2d338655a19919cabbf1b0e60adc149908462c5a66`; production React asset SHA-256 `0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0`.

With isolated HOME/TMPDIR and existing pinned dependencies, commands used:

```sh
cd "$UPSTREAM"
node node_modules/typescript/bin/tsc -b packages/client/ui-workflow-run/tsconfig.json --pretty false
cd packages/client/ui-workflow-run
node ../../../node_modules/tsdown/dist/run.mjs --config tsdown.config.ts --config-loader native --env.DSH_BUILD_FACE client
cd "$RESEARCH/workflow-browser"
R7_UPSTREAM="$UPSTREAM" node build.cjs
R7_UPSTREAM="$UPSTREAM" R7_PROJECT="$PROJECT" node fixture.cjs
PLAYWRIGHT_PATH="$PLAYWRIGHT" CHROMIUM_PATH="$CHROMIUM" REACT_BUNDLE_PATH="$REACT_ASSET" \
 R7_NATIVE_BUNDLE="$UPSTREAM/packages/client/ui-workflow-run/lib/client.js" \
 R7_BOARD_SOURCE="$PROJECT/packages/workflow-board-client/index.mjs" R7_PRIMITIVES_PATH="$PWD/primitives.cjs" \
 R7_THEME_PATH="$UPSTREAM/packages/client/ui-theme/src/styles/design-platform.css" node workflow.integration.cjs
```

The previous primitives experiment documents its initial upstream static bundle build. Browser execution used a fresh temporary context and reviewed macOS sandbox escalation; page-request blocking does not prove full process network isolation. Host sessions, event envelopes, workspace callbacks and store hooks are synthetic; `sourceBinding` is not authenticated. Real engine dispatch, durable lineage, actual adapter, live navigation/authorization, editor/rerun, Host restarts, screen-reader interaction and full E2E remain untested. No product source was changed or installed for this experiment.
