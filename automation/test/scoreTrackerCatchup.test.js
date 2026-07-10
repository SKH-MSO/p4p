import { test } from "node:test";
import assert   from "node:assert/strict";
import { selectMonthsToSend } from "../scripts/score-tracker.mjs";

const complete   = (missing = 0, total = 5) => ({ complete: missing === 0, missing, total });
const incomplete = (missing = 2, total = 5)  => ({ complete: false, missing, total });

test("single complete unsent month → returns just that one", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set(["2569_03"]);
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_04", status: complete() },
  ]);
});

test("newest incomplete, older complete unsent → returns the older one (bug fix)", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: incomplete() },
  ];
  const alreadySent = new Set();
  // Searching: 04 incomplete → keep looking (was `break` under the old
  // buggy semantics, permanently hiding 03); 03 complete, unsent → found.
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_03", status: complete() },
  ]);
});

test("two incomplete newer months, complete unsent further back → still found (multi-hop skip while searching)", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: incomplete() },
    { key: "2569_04", status: incomplete() },
  ];
  const alreadySent = new Set();
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_02", status: complete() },
  ]);
});

test("three consecutive complete unsent months → all bundled together (batching restored)", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: complete() },
  ];
  const alreadySent = new Set();
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_05", status: complete() },
    { key: "2569_04", status: complete() },
    { key: "2569_03", status: complete() },
  ]);
});

test("batch is capped at maxBatch — remainder left for a later run", () => {
  const months = [
    { key: "2569_01", status: complete() },
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set();
  assert.deepEqual(selectMonthsToSend(months, alreadySent, 2), [
    { key: "2569_04", status: complete() },
    { key: "2569_03", status: complete() },
  ]);
});

test("consecutive run interrupted by an incomplete month once collecting → stops there, doesn't skip the gap", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: incomplete() },
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: complete() },
  ];
  const alreadySent = new Set();
  // Searching hits 05 (complete, unsent) immediately — collection starts
  // there. 04 continues the run. 03 (incomplete) ends the run — it is NOT
  // skipped over to reach 02, since a gap inside a collected run is a real
  // discontinuity, not an in-progress month still being searched past.
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_05", status: complete() },
    { key: "2569_04", status: complete() },
  ]);
});

test("consecutive run interrupted by an already-sent month once collecting → stops there", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: complete() },
  ];
  const alreadySent = new Set(["2569_03"]);
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_05", status: complete() },
    { key: "2569_04", status: complete() },
  ]);
});

test("newest already sent, older complete+unsent months exist behind it → still found while searching", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: complete() },
  ];
  const alreadySent = new Set(["2569_05"]);
  // Searching skips the already-sent 05, finds 04 unsent → collection
  // starts there and continues through 03.
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_04", status: complete() },
    { key: "2569_03", status: complete() },
  ]);
});

test("null status (no data) while searching → skipped, doesn't block finding an older complete-unsent month", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: null },
    { key: "2569_04", status: null },
  ];
  const alreadySent = new Set();
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_02", status: complete() },
  ]);
});

test("null status once collecting → ends the run, same as an incomplete month", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: null },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set();
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_04", status: complete() },
  ]);
});

test("no complete month anywhere in the window → returns nothing", () => {
  const months = [
    { key: "2569_03", status: incomplete() },
    { key: "2569_04", status: incomplete() },
    { key: "2569_05", status: null },
  ];
  assert.deepEqual(selectMonthsToSend(months, new Set()), []);
});

test("all complete months already sent → returns nothing", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set(["2569_02", "2569_03", "2569_04"]);
  assert.deepEqual(selectMonthsToSend(months, alreadySent), []);
});

test("empty input → returns nothing", () => {
  assert.deepEqual(selectMonthsToSend([], new Set()), []);
});
