import { test } from "node:test";
import assert   from "node:assert/strict";
import { resolveBeYear } from "../claude-analyst.js";

test("full BE year in filename", () => {
  assert.equal(resolveBeYear("P4P_2569_02.xlsx", "", ""), 2569);
});

test("full CE year converted to BE", () => {
  assert.equal(resolveBeYear("report_2026.xlsx", "", ""), 2569);
});

test("short BE year (69 → 2569)", () => {
  assert.equal(resolveBeYear("P4P 69.xlsx", "", ""), 2569);
});

test("short CE year in subject (26 → 2026 → 2569)", () => {
  assert.equal(resolveBeYear("report.xlsx", "ส่ง P4P เดือน 26", ""), 2569);
});

test("body day number does not pollute result", () => {
  // Body has day number 28 — should not be read as short CE year
  // Filename has no year, subject has no year — resolves null
  assert.equal(resolveBeYear("report.xlsx", "", "วันที่ 28 มีนาคม"), null);
});

test("filename takes priority over subject", () => {
  // Filename: BE 2568, Subject: CE 2026 (→ BE 2569) — filename wins
  assert.equal(resolveBeYear("P4P_2568.xlsx", "2026", ""), 2568);
});

test("returns null when no year found", () => {
  assert.equal(resolveBeYear("", "", ""), null);
});

test("falls back to email received date when no year found anywhere", () => {
  // Reproduces the binkapisada@gmail.com case: name/month present in the
  // body but no year in subject, body, filename, or sheet.
  assert.equal(
    resolveBeYear("P4P-Intern.xlsx", "P4P Int", "เดือน มิถุนายน", "2026-07-01T17:08:15+07:00"),
    2569
  );
});

test("email date fallback is not used when a text year is present", () => {
  // Filename has an explicit year — must win over the email date fallback.
  assert.equal(
    resolveBeYear("P4P_2568.xlsx", "", "", "2026-07-01T17:08:15+07:00"),
    2568
  );
});

test("email date fallback ignored when unparseable", () => {
  assert.equal(resolveBeYear("", "", "", "not-a-date"), null);
});
