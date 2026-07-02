/**
 * scripts/extract-dept-heads.mjs
 *
 * ONE-OFF, LOCAL-ONLY bootstrap for the DEPT_HEADS_JSON secret used by
 * score-tracker.mjs. Do NOT run this as a GitHub Actions workflow — this
 * repo is public, and the output contains real staff email addresses.
 *
 * Scans every message under Gmail label "head" (sent P4P score reports),
 * derives the department name from the first attachment's filename
 * (format: "{dept} เดือน{month} {year}.xlsx" — everything before "เดือน"),
 * and collects the "To" recipient(s) as that department's head email(s).
 *
 * Usage (from automation/):
 *   node scripts/extract-dept-heads.mjs
 *
 * Output:
 *   - Diagnostics printed to stdout (review before trusting the JSON!)
 *   - Best-guess JSON written to OUTPUT_PATH (default: dept-heads.local.json,
 *     already .gitignore'd — never commit it). Paste its contents into the
 *     DEPT_HEADS_JSON GitHub secret by hand, then delete the local file.
 *
 * Environment variables:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   LABEL_NAME   (default: "head")
 *   OUTPUT_PATH  (default: dept-heads.local.json)
 */

import { google }         from "googleapis";
import { writeFileSync }  from "fs";
import { config as dotenvConfig } from "dotenv";

import { createGmailClient } from "../gmail-client.js";

dotenvConfig({ override: true });

const LABEL_NAME  = process.env.LABEL_NAME  ?? "head";
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? "dept-heads.local.json";

// ── Paginate all message IDs in a label ──────────────────────────────────────
async function listAllIds(rawGmail, labelId) {
  const ids = [];
  let pageToken;
  do {
    const res = await rawGmail.users.messages.list({
      userId: "me", labelIds: [labelId], maxResults: 500, pageToken,
    });
    for (const m of res.data.messages ?? []) ids.push(m.id);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return ids;
}

// ── Department name from attachment filename: everything before "เดือน" ─────
function extractDeptFromFilename(filename) {
  if (!filename) return null;
  const base = filename.replace(/\.(xlsx|xls|csv|pdf)$/i, "").trim();
  const idx  = base.indexOf("เดือน");
  const dept = (idx > 0 ? base.slice(0, idx) : base).replace(/\s+/g, " ").trim();
  return dept || null;
}

// ── Department name fallback: subject text after "กลุ่มงาน" ─────────────────
function extractDeptFromSubject(subject) {
  if (!subject) return null;
  const idx = subject.lastIndexOf("กลุ่มงาน");
  if (idx === -1) return null;
  const dept = subject.slice(idx + "กลุ่มงาน".length).replace(/\s+/g, " ").trim();
  return dept || null;
}

// ── Parse comma-separated "To" header into bare lowercase addresses ─────────
function extractEmails(headerValue) {
  if (!headerValue) return [];
  return headerValue
    .split(",")
    .map((part) => {
      const m = part.match(/<([^>]+)>/);
      return (m ? m[1] : part).trim().toLowerCase();
    })
    .filter(Boolean);
}

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  Extract dept → head email(s) from Gmail label");
  console.log(`${"═".repeat(60)}\n`);

  const gmailClient = createGmailClient();

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN)
    throw new Error("Missing Google OAuth env vars");
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const rawGmail = google.gmail({ version: "v1", auth });

  // ── Step 1: resolve label ────────────────────────────────────────────────
  const labels  = await gmailClient.listLabels(LABEL_NAME);
  if (!labels.length) throw new Error(`Label "${LABEL_NAME}" not found`);
  const exact   = labels.find((l) => l.name.toLowerCase() === LABEL_NAME.toLowerCase());
  const label   = exact ?? labels[0];
  if (labels.length > 1 && !exact) {
    console.log(`⚠️  Multiple labels match "${LABEL_NAME}": ${labels.map(l => l.name).join(", ")}`);
    console.log(`    Using "${label.name}"\n`);
  }
  console.log(`📂  Label: "${label.name}" (${label.id})`);

  // ── Step 2: list all message IDs ─────────────────────────────────────────
  const allIds = await listAllIds(rawGmail, label.id);
  console.log(`📧  ${allIds.length} messages found\n`);

  // ── Step 3: extract dept + recipients per message ────────────────────────
  const deptEmails    = new Map(); // dept → Set<email>
  const deptMessages  = new Map(); // dept → count
  const unresolved    = [];

  for (let i = 0; i < allIds.length; i++) {
    const id = allIds[i];
    const { msg, attachments } = await gmailClient.getMessageWithAttachments(id);

    const deptFromFile = extractDeptFromFilename(attachments[0]?.filename);
    const deptFromSubj = extractDeptFromSubject(msg.subject);
    const dept = deptFromFile ?? deptFromSubj;

    if (deptFromFile && deptFromSubj && deptFromFile !== deptFromSubj) {
      console.log(`⚠️  Filename/subject dept mismatch on "${msg.subject}": ` +
        `filename="${deptFromFile}" subject="${deptFromSubj}" — using filename`);
    }

    if (!dept) {
      unresolved.push({ id, subject: msg.subject, to: msg.to, attachment: attachments[0]?.filename ?? "(none)" });
      continue;
    }

    const emails = extractEmails(msg.to);
    if (!deptEmails.has(dept)) deptEmails.set(dept, new Set());
    emails.forEach((e) => deptEmails.get(dept).add(e));
    deptMessages.set(dept, (deptMessages.get(dept) ?? 0) + 1);

    if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${allIds.length} scanned`);
  }

  // ── Step 4: print diagnostics ─────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Departments found: ${deptEmails.size}`);
  console.log(`${"─".repeat(60)}`);

  const sortedDepts = [...deptEmails.keys()].sort();
  for (const dept of sortedDepts) {
    const emails = [...deptEmails.get(dept)];
    const count  = deptMessages.get(dept);
    console.log(`  ${dept}  (${count} msg${count === 1 ? "" : "s"})`);
    for (const e of emails) console.log(`      → ${e}`);
  }

  if (unresolved.length) {
    console.log(`\n⚠️  ${unresolved.length} message(s) with no parsable department — review manually:`);
    for (const u of unresolved) {
      console.log(`  - [${u.id}] "${u.subject}" (attachment: ${u.attachment}, to: ${u.to})`);
    }
  }

  // ── Step 5: write best-guess JSON ─────────────────────────────────────────
  const result = {};
  for (const [dept, emails] of deptEmails) {
    result[dept] = [...emails].join(",");
  }
  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n", "utf8");

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  📄  Wrote ${OUTPUT_PATH}`);
  console.log(`  Review the diagnostics above, hand-correct any gaps/mismatches,`);
  console.log(`  then paste the JSON into the DEPT_HEADS_JSON secret. Do not commit this file.`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("\n❌ Fatal:", err.message);
  process.exit(1);
});
