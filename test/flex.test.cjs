// Structural tests for the LINE Flex "choose a month" picker builder.
// The exact month labels depend on the current date, so these assert on the
// stable shape rather than specific months.
const { test } = require("node:test")
const assert = require("node:assert/strict")

const { createStatusList, createStatusSublist } = require("../src/flex.cjs")

test("createStatusList: is a flex bubble with a 6-row body", () => {
  const msg = createStatusList()
  assert.equal(msg.type, "flex")
  assert.equal(msg.contents.type, "bubble")
  assert.equal(msg.contents.body.contents.length, 6)
})

test("createStatusSublist: each row links into the status LIFF app", () => {
  const row = createStatusSublist(0)
  assert.equal(row.type, "box")
  // The clickable half carries the LIFF uri action.
  const button = row.contents.find((c) => c.action)
  assert.ok(button, "row has a box with an action")
  assert.equal(button.action.type, "uri")
  assert.match(button.action.uri, /^https:\/\/liff\.line\.me\/.*sheetname=\d{4}_\d{2}/)
})

test("createStatusSublist: sheetname in the label is BE-year_MM formatted", () => {
  for (let i = 0; i < 6; i++) {
    const row = createStatusSublist(i)
    const button = row.contents.find((c) => c.action)
    assert.match(button.action.label, /^\d{4}_\d{2}$/, "row " + i + " label is YYYY_MM")
  }
})
