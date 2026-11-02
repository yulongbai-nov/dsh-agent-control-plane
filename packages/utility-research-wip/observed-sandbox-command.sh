#!/bin/sh
set -eu
cd /Users/yulong/Documents/Codex/2026-11-02/p-le/work/upstream-utility-wip
exec env -i PATH=/usr/bin:/bin TMPDIR=/Users/yulong/Documents/Codex/2026-11-02/p-le/work/utility-sandbox-tmp CI=1 NO_COLOR=1 \
  /usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*) (deny file-read* file-write* (subpath "/Applications/DeepSeek Harness.app")) (deny file-read* file-write* (subpath "/Users/yulong/.dsh")) (deny file-read* file-write* (subpath "/Users/yulong/.codex")) (deny file-read* file-write* (subpath "/Users/yulong/Documents/deepseek-harness"))' \
  /opt/homebrew/bin/node node_modules/vitest/vitest.mjs run packages/core/tools/tests/synthetic-utility-wip.host.spec.ts --no-file-parallelism --reporter=verbose
