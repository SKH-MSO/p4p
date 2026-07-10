import { test } from "node:test";
import assert   from "node:assert/strict";
import { selectMonthToSend } from "../scripts/score-tracker.mjs";

const complete   = (missing = 0, total = 5) => ({ complete: missing === 0, missing, total });
const incomplete = (missing = 2, total = 5)  => ({ complete: false, missing, total });

test("newest complete, unsent → returns just that one", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set();
  // Walk newest→oldest: 04 complete, unsent → this is the answer
  assert.deepEqual(selectMonthToSend(months, alreadySent), [
    { key: "2569_04", status: complete() },
  ]);
});

test("newest incomplete, older complete unsent → returns the older one (bug fix)", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: incomplete() },
  ];
  const alreadySent = new Set();
  // Walk newest→oldest: 04 incomplete → keep scanning (was `break` under the
  // old buggy semantics, which meant 03 could never be reported); 03
  // complete, unsent → this is the answer.
  assert.deepEqual(selectMonthToSend(months, alreadySent), [
    { key: "2569_03", status: complete() },
  ]);
});

test("two incomplete newer months, complete unsent further back → still found (multi-hop skip)", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: incomplete() },
    { key: "2569_04", status: incomplete() },
  ];
  const alreadySent = new Set();
  // Walk newest→oldest: 04 incomplete → skip, 03 incomplete → skip, 02 complete unsent → answer
  assert.deepEqual(selectMonthToSend(months, alreadySent), [
    { key: "2569_02", status: complete() },
  ]);
});

test("newest complete already sent → returns nothing (no fallback to an older complete-unsent month)", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set(["2569_04"]);
  // 04 is the latest complete month, and it's already sent — that is the
  // definitive answer. 03 (also complete, also unsent) is never reached.
  assert.deepEqual(selectMonthToSend(months, alreadySent), []);
});

test("newest complete unsent, older ALSO complete unsent → only the newest is returned, never both", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: complete() },
  ];
  const alreadySent = new Set();
  // Proves no batching: even though 03/04/05 are all complete and unsent,
  // only the single latest (05) is selected.
  assert.deepEqual(selectMonthToSend(months, alreadySent), [
    { key: "2569_05", status: complete() },
  ]);
});

test("null status (no data) at the newest position → skipped, older complete unsent found", () => {
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: null }, // department wasn't tracked that month
  ];
  const alreadySent = new Set();
  assert.deepEqual(selectMonthToSend(months, alreadySent), [
    { key: "2569_03", status: complete() },
  ]);
});

test("null status sandwiched between two complete months → newer complete one wins", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: null },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set();
  // The null month must not be mistaken for "found" nor block the scan —
  // 04 (newest complete) is the answer, not 02.
  assert.deepEqual(selectMonthToSend(months, alreadySent), [
    { key: "2569_04", status: complete() },
  ]);
});

test("no complete month anywhere in the window → returns nothing", () => {
  const months = [
    { key: "2569_03", status: incomplete() },
    { key: "2569_04", status: incomplete() },
    { key: "2569_05", status: null },
  ];
  const alreadySent = new Set();
  assert.deepEqual(selectMonthToSend(months, new Set()), []);
});

test("all months already sent, including the latest complete one → returns nothing", () => {
  const months = [
    { key: "2569_02", status: complete() },
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
  ];
  const alreadySent = new Set(["2569_02", "2569_03", "2569_04"]);
  assert.deepEqual(selectMonthToSend(months, alreadySent), []);
});

test("empty input → returns nothing", () => {
  assert.deepEqual(selectMonthToSend([], new Set()), []);
});
