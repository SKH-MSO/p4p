import { test } from "node:test";
import assert   from "node:assert/strict";
import { selectMonthsToSend } from "../scripts/score-tracker.mjs";

const complete   = (missing = 0, total = 5) => ({ complete: missing === 0, missing, total });
const incomplete = (missing = 2, total = 5)  => ({ complete: false, missing, total });

test("all window months already sent → nothing to send", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set(["2569_03", "2569_04"]);
  assert.deepEqual(selectMonthsToSend(months, alreadySent), []);
});

test("newest month incomplete → nothing to send", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: incomplete() },
  ];
  const alreadySent = new Set();
  // Walk newest→oldest: 04 incomplete → stop
  assert.deepEqual(selectMonthsToSend(months, alreadySent), []);
});

test("only newest complete unsent month", () => {
  const months = [
    { key: "2569_03", status: incomplete() },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set();
  // Walk newest→oldest: 04 complete, unsent → add; 03 incomplete → stop
  // Result: [04] (newest-to-oldest order)
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_04", status: complete() },
  ]);
});

test("two consecutive newest complete unsent months bundled together", () => {
  const months = [
    { key: "2569_03", status: incomplete() },
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: complete() },
  ];
  const alreadySent = new Set();
  // Walk newest→oldest: 05 complete → add; 04 complete → add; 03 incomplete → stop
  // Result: [05, 04] (newest-to-oldest)
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_05", status: complete() },
    { key: "2569_04", status: complete() },
  ]);
});

test("newest complete unsent, older incomplete, even older complete → only newest", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: incomplete() },
    { key: "2569_05", status: complete() },
  ];
  const alreadySent = new Set();
  // Walk newest→oldest: 05 complete → add; 04 incomplete → stop
  // Result: [05] (can't reach 03 because 04 blocks)
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_05", status: complete() },
  ]);
});

test("null status (no data) in the middle doesn't block later months", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: null },           // department didn't exist yet
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set();
  // Walk newest→oldest: 04 complete → add; 03 null → skip; 02 complete → add
  // Result: [04, 02] (newest-to-oldest, skipping null)
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_04", status: complete() },
    { key: "2569_02", status: complete() },
  ]);
});

test("newest month already sent → nothing to send", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set(["2569_04"]);
  // Walk newest→oldest: 04 already sent → stop
  // Result: [] (don't reach 03)
  assert.deepEqual(selectMonthsToSend(months, alreadySent), []);
});

test("multiple complete unsent after incomplete month only takes newest complete", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: incomplete() },
  ];
  const alreadySent = new Set();
  // Walk newest→oldest: 04 incomplete → stop
  // Result: [] (can't reach 03 or 02 because 04 blocks)
  assert.deepEqual(selectMonthsToSend(months, alreadySent), []);
});
