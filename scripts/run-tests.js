// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Runs test scripts' [name, fn] lists in order, awaiting each (used by
// scripts/test-web.js and scripts/test-app.js). A test whose promise never
// settles leaves Node with nothing to wait for, so the process would end
// with exit code 0 as if all had passed (issue #91): the run counts as
// failed until the last test has finished, and the stuck test is named.
"use strict";

module.exports = function runTests(tests, passed = 0) {
  let running = null, finished = false;
  process.on("exit", (code) => {
    if (finished || code !== 0) return;
    const left = tests.length - tests.findIndex(([name]) => name === running) - 1;
    console.error(`not finished: "${running}" never settled${left ? `, ${left} test(s) after it did not run` : ""}`);
    process.exitCode = 1;
  });
  return (async () => {
    for (const [name, fn] of tests) { running = name; await fn(); passed++; console.log("ok", name); }
    finished = true;
    console.log(`${passed} tests passed`);
  })().catch((e) => { console.error(e); process.exit(1); });
};
