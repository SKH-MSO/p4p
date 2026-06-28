/**
 * scripts/match-sender-emails.mjs
 *
 * For every message in Gmail label "เอกสาร P4P":
 *   1. Extract physician name from xlsx attachment filename, email subject, or body
 *      (JS-side only — same logic as the live pipeline in index.js)
 *   2. If still no name, download the xlsx and scan sheet header cells / tab name
 *   3. Fuzzy-match the name against all YYYY_MM Supabase roster tables
 *
 * Groups messages by sender email — stops trying once a confident match is found.
 * Deduplicates output to one row per physician (keeps the sender with highest
 * email_count; tie-break: highest similarity).
 * Writes (overwrites) sender-physician-match.csv.
 *
 * Environment variables:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   SUPABASE_URL, SUPABASE_KEY
 *   OUTPUT_PATH  (default: $GITHUB_WORKSPACE/sender-physician-match.csv or ../sender-physician-match.csv)
 */

import { google }        from "googleapis";
import { createClient }  from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import ExcelJS           from "exceljs";
import { config as dotenvConfig } from "dotenv";

import { createGmailClient }                                       from "../gmail-client.js";
import { resolvePhysicianName, resolvePhysicianNameFromSheet }     from "../claude-analyst.js";
import { matchName }                                               from "../supabase-client.js";
import { MONTH_TOKENS_BY_NUM }                                     from "../months.js";

dotenvConfig({ override: true });

const LABEL_NAME  = "เอกสาร P4P";
const OUTPUT_PATH = process.env.OUTPUT_PATH
  ?? (process.env.GITHUB_WORKSPACE
      ? `${process.env.GITHUB_WORKSPACE}/sender-physician-match.csv`
      : "../sender-physician-match.csv");

// ── Parse "Display Name <email@host>" or bare "email@host" ───────────────────
function parseFrom(header) {
  const m = header.match(/^(.*?)\s*<([^>]+)>\s*$/);
  return m
    ? { name: m[1].trim(), email: m[2].trim().toLowerCase() }
    : { name: "", email: header.trim().toLowerCase() };
}

// ── Paginate all message IDs in a label ──────────────────────────────────────
async function listAllIds(gmail, labelId) {
  const ids = [];
  let pageToken;
  do {
    const res = await gmail.users.messages.list({
      userId: "me", labelIds: [labelId], maxResults: 500, pageToken,
    });
    for (const m of res.data.messages ?? []) ids.push(m.id);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return ids;
}

// ── Excel parsing (mirrors firstSheetToRows / backfill-drive-scores) ─────────
async function parseExcel(buffer, targetMonth) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheets = wb.worksheets;
  if (!sheets.length) throw new Error("Workbook has no sheets");

  function nonNullCount(ws) {
    let n = 0;
    ws.eachRow(row => row.eachCell({ includeEmpty: false }, cell => {
      if (cell.value !== null && cell.value !== undefined) n++;
    }));
    return n;
  }

  let idx = 0;
  if (nonNullCount(sheets[0]) < 3 && sheets.length > 1) idx = 1;

  if (targetMonth && sheets.length > 1) {
    const toks = MONTH_TOKENS_BY_NUM[targetMonth] ?? [];
    const m = sheets.findIndex(ws => toks.some(t => ws.name.toLowerCase().includes(t)));
    if (m !== -1 && nonNullCount(sheets[m]) >= 3) idx = m;
  }

  const ws   = sheets[idx];
  const rows = [];

  ws.eachRow(row => {
    if (!row.hasValues) return;
    const obj = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = `col_${col}`;
      const val = cell.value;
      const isMaster = val !== null && typeof val === "object" && "formula" in val;
      const isClone  = val !== null && typeof val === "object" && "sharedFormula" in val && !("formula" in val);
      if (isMaster || isClone) {
        const r = cell.result;
        obj[key] = isClone ? (typeof r === "number" ? r : null) : (r instanceof Date ? r.toISOString() : r ?? null);
        return;
      }
      if (val === null || val === undefined)                            obj[key] = null;
      else if (val instanceof Date)                                     obj[key] = val.toISOString();
      else if (typeof val === "object" && Array.isArray(val.richText)) obj[key] = val.richText.map(r => r.text ?? "").join("");
      else if (typeof val === "object" && "text" in val)               obj[key] = String(val.text ?? "");
      else                                                              obj[key] = val;
    });
    if (Object.keys(obj).length) rows.push(obj);
  });

  return { rows, sheetName: ws.name };
}

// ── Discover all YYYY_MM roster tables via PostgREST OpenAPI spec ─────────────
async function getRosterTables() {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`PostgREST spec fetch failed: ${res.status}`);
  const spec = await res.json();
  return Object.keys(spec.paths ?? {})
    .map(p => p.replace(/^\//, ""))
    .filter(t => /^\d{4}_\d{2}$/.test(t))
    .sort();
}

// ── Try to find + match a physician name from one message ─────────────────────
async function tryMessage(gmailClient, rawGmail, msgId, tables) {
  const { msg, attachments } = await gmailClient.getMessageWithAttachments(msgId);
  const xlsx = attachments.find(a => /\.xlsx$/i.test(a.filename ?? ""));

  // Pass 1: JS-side extraction from filename / subject / body
  const nameFromMeta = resolvePhysicianName(xlsx?.filename ?? null, msg.subject, msg.body);

  if (nameFromMeta) {
    for (const table of tables) {
      const hit = await matchName(nameFromMeta, table);
      if (hit) return { extractedName: nameFromMeta, source: "filename/subject/body", hit };
    }
  }

  // Pass 2: download xlsx and scan sheet header cells / tab name
  if (xlsx) {
    try {
      const res = await rawGmail.users.messages.attachments.get({
        userId: "me", messageId: msgId, id: xlsx.attachmentId,
      });
      const base64 = res.data.data.replace(/-/g, "+").replace(/_/g, "/");
      const buffer = Buffer.from(base64, "base64");
      const { rows, sheetName } = await parseExcel(buffer, null);
      const candidates = resolvePhysicianNameFromSheet(rows, sheetName);

      for (const candidate of candidates) {
        for (const table of tables) {
          const hit = await matchName(candidate, table);
          if (hit) return { extractedName: candidate, source: "excel_sheet", hit };
        }
      }
    } catch {
      // attachment download / parse failed — skip
    }
  }

  return null; // could not resolve
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function csvCell(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
function csvRow(cols, obj) { return cols.map(c => csvCell(obj[c])).join(","); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  Gmail → Supabase  Sender / Physician Match");
  console.log(`${"═".repeat(60)}\n`);

  const gmailClient = createGmailClient();

  // Raw googleapis client (needed for attachment download pagination)
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN)
    throw new Error("Missing Google OAuth env vars");
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const rawGmail = google.gmail({ version: "v1", auth });

  // ── Step 1: resolve label ────────────────────────────────────────────────
  const labels = await gmailClient.listLabels(LABEL_NAME);
  if (!labels.length) throw new Error(`Label "${LABEL_NAME}" not found`);
  const labelId = labels[0].id;
  console.log(`📂  Label: "${LABEL_NAME}" (${labelId})`);

  // ── Step 2: list all message IDs ─────────────────────────────────────────
  console.log("📧  Listing messages…");
  const allIds = await listAllIds(rawGmail, labelId);
  console.log(`    ${allIds.length} messages found\n`);

  // ── Step 3: group by sender (lightweight metadata fetch) ─────────────────
  console.log("👤  Grouping by sender…");
  const senderMap = new Map(); // email → { displayName, email, messageIds[] }

  for (let i = 0; i < allIds.length; i++) {
    const res = await rawGmail.users.messages.get({
      userId: "me", id: allIds[i], format: "metadata", metadataHeaders: ["From"],
    });
    const fromVal = res.data.payload?.headers
      ?.find(h => h.name.toLowerCase() === "from")?.value ?? "";
    if (!fromVal) continue;

    const { name, email } = parseFrom(fromVal);
    if (!senderMap.has(email)) {
      senderMap.set(email, { displayName: name, email, messageIds: [allIds[i]] });
    } else {
      senderMap.get(email).messageIds.push(allIds[i]);
    }

    if ((i + 1) % 50 === 0) console.log(`  … ${i + 1}/${allIds.length} scanned`);
  }
  console.log(`\n    ${senderMap.size} unique senders\n`);

  // ── Step 4: discover roster tables ───────────────────────────────────────
  console.log("📋  Loading Supabase roster tables…");
  const tables = await getRosterTables();
  console.log(`    Tables: ${tables.join(", ")}\n`);

  // ── Step 5: match each sender ─────────────────────────────────────────────
  console.log("🔍  Matching senders…\n");
  const COLS = [
    "sender_email", "sender_display_name", "email_count",
    "extracted_name", "name_source",
    "matched_physician", "department", "similarity", "matched",
  ];
  const results = [];

  let done = 0;
  for (const { displayName, email, messageIds } of senderMap.values()) {
    done++;
    process.stdout.write(`[${done}/${senderMap.size}] ${email} … `);

    let result = null;

    // Try messages (most recent first) until a match is found
    for (const msgId of messageIds) {
      try {
        result = await tryMessage(gmailClient, rawGmail, msgId, tables);
        if (result) break;
      } catch {
        // skip failed messages
      }
    }

    if (result) {
      console.log(`✅ ${result.hit.matchedName} (${(result.hit.similarity * 100).toFixed(0)}%)`);
      results.push({
        sender_email      : email,
        sender_display_name: displayName,
        email_count       : messageIds.length,
        extracted_name    : result.extractedName,
        name_source       : result.source,
        matched_physician : result.hit.matchedName,
        department        : result.hit.department,
        similarity        : result.hit.similarity.toFixed(3),
        matched           : "yes",
      });
    } else {
      console.log("—");
      results.push({
        sender_email      : email,
        sender_display_name: displayName,
        email_count       : messageIds.length,
        extracted_name    : "",
        name_source       : "none",
        matched_physician : "",
        department        : "",
        similarity        : "0.000",
        matched           : "no",
      });
    }
  }

  // Sort: matched first, then by similarity desc
  results.sort((a, b) => {
    if (a.matched !== b.matched) return a.matched === "yes" ? -1 : 1;
    return parseFloat(b.similarity) - parseFloat(a.similarity);
  });

  // ── Step 6: deduplicate — one row per physician ───────────────────────────
  // For physicians with multiple sender emails, keep the address with the highest
  // email_count (most-used). Tie-break: highest similarity, then first occurrence.
  const best = new Map(); // matched_physician → result row
  for (const row of results) {
    if (row.matched !== "yes") continue;
    const prev = best.get(row.matched_physician);
    if (
      !prev ||
      row.email_count > prev.email_count ||
      (row.email_count === prev.email_count && parseFloat(row.similarity) > parseFloat(prev.similarity))
    ) {
      best.set(row.matched_physician, row);
    }
  }
  const outputRows = [...best.values()];

  // ── Step 7: write CSV (always overwrite) ──────────────────────────────────
  const lines = [COLS.join(","), ...outputRows.map(r => csvRow(COLS, r))];
  writeFileSync(OUTPUT_PATH, lines.join("\n") + "\n", "utf8");

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ✅  ${outputRows.length} physicians  (${results.length} total senders scanned)`);
  console.log(`  📄  CSV → ${OUTPUT_PATH}`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch(err => {
  console.error("\n❌ Fatal:", err.message);
  process.exit(1);
});
