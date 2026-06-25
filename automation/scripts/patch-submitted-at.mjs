/**
 * patch-submitted-at.mjs
 *
 * Searches Gmail label "เอกสาร P4P" for submission emails from specific
 * physicians, then writes their submission timestamp into the Supabase
 * month table's submitted_at column.
 *
 * Usage:
 *   TARGET_DATE=2569_03 PHYSICIAN_NAMES="ณัฐพงศ์ รั้วมั่น,จารุวรรณ โชคนาคะวโร" \\
 *     node scripts/patch-submitted-at.mjs
 */

import { createGmailClient } from "../gmail-client.js";
import { createClient }      from "@supabase/supabase-js";

const TARGET_DATE      = process.env.TARGET_DATE      ?? "2569_03";
const PHYSICIAN_NAMES  = (process.env.PHYSICIAN_NAMES ?? "").split(",").map(s => s.trim()).filter(Boolean);
const DRY_RUN          = process.env.DRY_RUN === "true";

if (PHYSICIAN_NAMES.length === 0) {
  console.error("❌  Set PHYSICIAN_NAMES env var (comma-separated full names)");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const gmail    = createGmailClient();

// ── 1. Resolve the label ID for "เอกสาร P4P" ─────────────────────────────
console.log(`\n🔍  Resolving Gmail label "เอกสาร P4P"…`);
const labels = await gmail.listLabels("เอกสาร P4P");
if (labels.length === 0) {
  console.error('❌  Label "เอกสาร P4P" not found in Gmail');
  process.exit(1);
}
const labelId = labels[0].id;
console.log(`    label ID: ${labelId}  (${labels[0].name})`);

// ── 2. Compute CE date range from the BE TARGET_DATE ─────────────────────
const [beYearStr, monthStr] = TARGET_DATE.split("_");
const ceYear  = parseInt(beYearStr, 10) - 543;
const month   = parseInt(monthStr, 10);
const afterDate  = `${ceYear}/${String(month).padStart(2, "0")}/01`;
const nextMonth  = month === 12 ? 1 : month + 1;
const nextYear   = month === 12 ? ceYear + 1 : ceYear;
const beforeDate = `${nextYear}/${String(nextMonth).padStart(2, "0")}/01`;
console.log(`📅  Date filter: after:${afterDate} before:${beforeDate}`);

// ── 3. For each physician, search Gmail within that month window ─────────
for (const physicianName of PHYSICIAN_NAMES) {
  console.log(`\n👤  Searching for: ${physicianName}`);

  const tokens = physicianName.split(/\s+/).filter(Boolean);
  const nameQuery = tokens.join(" ");

  const messages = await gmail.listMessages({
    labelIds : labelId,
    query    : `${nameQuery} after:${afterDate} before:${beforeDate}`,
    maxResults: 20,
  });

  if (messages.length === 0) {
    console.warn(`    ⚠️  No messages found — skipping`);
    continue;
  }

  console.log(`    Found ${messages.length} candidate message(s)`);

  // Fetch each message and find the earliest date
  let earliest = null;

  for (const { id } of messages) {
    const msg  = await gmail.readMessage(id);
    const date = new Date(msg.date);
    if (isNaN(date.getTime())) continue;

    console.log(`    📧  [${date.toISOString()}]  ${msg.subject}`);

    if (!earliest || date < earliest.date) {
      earliest = { date, subject: msg.subject, messageId: id };
    }
  }

  if (!earliest) {
    console.warn(`    ⚠️  Could not parse any message dates — skipping`);
    continue;
  }

  const submittedAt = earliest.date.toISOString();
  console.log(`    ✅  Earliest submission: ${submittedAt}`);
  console.log(`        Subject: ${earliest.subject}`);

  // ── 4. Look up the Supabase row by matching physician name ───────────────
  const { data: rows, error: fetchErr } = await supabase
    .from(TARGET_DATE)
    .select("index, firstname, lastname, submitted_at")
    .or(
      tokens.map(t => `firstname.ilike.%${t}%`).concat(
        tokens.map(t => `lastname.ilike.%${t}%`)
      ).join(",")
    );

  if (fetchErr) {
    console.error(`    ❌  Supabase fetch error: ${fetchErr.message}`);
    continue;
  }

  if (!rows || rows.length === 0) {
    console.warn(`    ⚠️  No matching Supabase row found — skipping`);
    continue;
  }

  // Pick the best-matching row (prefer exact full-name match)
  const normFull = physicianName.replace(/\s+/g, " ").trim().toLowerCase();
  const best = rows.find(r => {
    const full = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim().toLowerCase();
    return full === normFull;
  }) ?? rows[0];

  const full = `${best.firstname ?? ""} ${best.lastname ?? ""}`.trim();
  console.log(`    🗄️   Row: index=${best.index}  name="${full}"  current submitted_at=${best.submitted_at ?? "NULL"}`);

  if (best.submitted_at != null) {
    console.log(`    ⏩  submitted_at already set — skipping`);
    continue;
  }

  if (DRY_RUN) {
    console.log(`    🧪  DRY_RUN — would set submitted_at = ${submittedAt}`);
    continue;
  }

  const { error: updateErr } = await supabase
    .from(TARGET_DATE)
    .update({ submitted_at: submittedAt })
    .eq("index", best.index);

  if (updateErr) {
    console.error(`    ❌  Supabase update error: ${updateErr.message}`);
  } else {
    console.log(`    ✅  Updated submitted_at = ${submittedAt}`);
  }
}

console.log("\n✅  Done.");
