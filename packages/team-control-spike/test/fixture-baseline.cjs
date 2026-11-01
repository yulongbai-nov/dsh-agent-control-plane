'use strict';
// Test-support only. No filesystem, app paths, native modules or caller-verified
// identity capability exist here. This lock has no unlock mechanism.
function failure(code) { return Object.assign(new Error(code), { code }); }
async function loadFixtureClasses() {
  throw failure('NATIVE_BASELINE_UNVERIFIED');
}
module.exports = { loadFixtureClasses };
