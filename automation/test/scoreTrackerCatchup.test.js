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

test("oldest unsent month still incomplete → blocked, nothing to send", () => {
  // Mirrors the March/April scenario: March already sent, April is the
  // oldest unsent month but is still missing scores — must not send.
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: incomplete(1, 5) },
  ];
  const alreadySent = new Set(["2569_03"]);
  assert.deepEqual(selectMonthsToSend(months, alreadySent), []);
});

test("oldest unsent month just became complete → send exactly that one", () => {
  // April has now been fully submitted — should be selected, May not yet.
  const months = [
    { key: "2569_03", status: complete() },
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: incomplete(3, 5) },
  ];
  const alreadySent = new Set(["2569_03"]);
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_04", status: complete() },
  ]);
});

test("two consecutive complete unsent months are bundled together", () => {
  const months = [
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: complete() },
    { key: "2569_06", status: incomplete() },
  ];
  const alreadySent = new Set();
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: complete() },
  ]);
});

test("a month with no data (status null) is skipped without blocking later months", () => {
  const months = [
    { key: "2569_02", status: null }, // department didn't exist yet
    { key: "2569_03", status: complete() },
  ];
  const alreadySent = new Set();
  assert.deepEqual(selectMonthsToSend(months, alreadySent), [
    { key: "2569_03", status: complete() },
  ]);
});

test("fully caught up and no new complete month → nothing to send", () => {
  const months = [
    { key: "2569_04", status: complete() },
    { key: "2569_05", status: incomplete() },
  ];
  const alreadySent = new Set(["2569_04"]);
  assert.deepEqual(selectMonthsToSend(months, alreadySent), []);
});
