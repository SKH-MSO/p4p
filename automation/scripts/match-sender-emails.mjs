/**
 * scripts/match-sender-emails.mjs
 *
 * Lists every message in Gmail label "เอกสาร P4P", extracts unique senders,
 * then fuzzy-matches each sender name against physician names from all YYYY_MM
 * Supabase roster tables. Writes results to sender-physician-match.csv.
 *
 * Environment variables:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   SUPABASE_URL, SUPABASE_KEY
 *   OUTPUT_PATH  (optional — default: $GITHUB_WORKSPACE/sender-physician-match.csv
 *                 or ../sender-physician-match.csv when run locally)
 */

import { google }       from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { config as dotenvConfig } from "dotenv";
import { similarity }   from "../supabase-client.js";

dotenvConfig({ override: true });

const LABEL_NAME = "เอกสาร P4P";
const THRESHOLD  = 0.6;
const OUTPUT_PATH = process.env.OUTPUT_PATH
  ?? (process.env.GITHUB_WORKSPACE
      ? `${process.env.GITHUB_WORKSPACE}/sender-physician-match.csv`
      : "../sender-physician-match.csv");

// ── Gmail setup ───────────────────────────────────────────────────────────────
function createGmail() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN)
    throw new Error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN");
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

// ── Parse "Display Name <email@host>" or bare "email@host" ───────────────────
function parseFrom(header) {
  const m = header.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: header.trim().toLowerCase() };
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

// ── Fetch From header only (metadata format — lightweight) ───────────────────
async function collectSenders(gmail, ids) {
  const map = new Map(); // email → { name, email, count }
  let done = 0;
  for (const id of ids) {
    const res = await gmail.users.messages.get({
      userId: "me", id, format: "metadata", metadataHeaders: ["From"],
    });
    const fromVal = res.data.payload?.headers
      ?.find(h => h.name.toLowerCase() === "from")?.value ?? "";
    if (fromVal) {
      const { name, email } = parseFrom(fromVal);
      if (map.has(email)) {
        map.get(email).count++;
      } else {
        map.set(email, { name, email, count: 1 });
      }
    }
    done++;
    if (done % 50 === 0) console.log(`  … ${done}/${ids.length} messages scanned`);
  }
  return map;
}

// ── Discover all YYYY_MM tables via PostgREST OpenAPI spec ───────────────────
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

// ── Collect unique physicians across all roster tables ────────────────────────
async function fetchPhysicians(supabase, tables) {
  const seen = new Set();
  const list = [];
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("firstname, lastname, department")
      .limit(1000);
    if (error) { console.warn(`  ⚠️  ${table}: ${error.message}`); continue; }
    for (const row of data ?? []) {
      const full = [row.firstname, row.lastname].filter(Boolean).join(" ");
      if (!full || seen.has(full)) continue;
      seen.add(full);
      list.push({ fullName: full, department: row.department ?? "" });
    }
  }
  return list;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function csvCell(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
function csvRow(cols) { return cols.map(csvCell).join(","); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(56)}`);
  console.log("  Gmail → Supabase  Sender / Physician Match");
  console.log(`${"═".repeat(56)}\n`);

  const gmail    = createGmail();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  // ── Step 1: resolve label ─────────────────────────────────────────────────
  const labelsRes = await gmail.users.labels.list({ userId: "me" });
  const label = (labelsRes.data.labels ?? []).find(l => l.name === LABEL_NAME);
  if (!label) throw new Error(`Label "${LABEL_NAME}" not found in Gmail`);
  console.log(`📂  Label: "${LABEL_NAME}"  (${label.id})`);

  // ── Step 2: list all message IDs ─────────────────────────────────────────
  console.log("📧  Listing messages…");
  const ids = await listAllIds(gmail, label.id);
  console.log(`    ${ids.length} messages found\n`);

  // ── Step 3: extract unique senders ───────────────────────────────────────
  console.log("👤  Fetching sender headers…");
  const senderMap = await collectSenders(gmail, ids);
  console.log(`\n    ${senderMap.size} unique senders\n`);

  // ── Step 4: load physicians from Supabase ─────────────────────────────────
  console.log("📋  Loading Supabase roster tables…");
  const tables = await getRosterTables();
  console.log(`    Tables: ${tables.join(", ")}`);
  const physicians = await fetchPhysicians(supabase, tables);
  console.log(`    ${physicians.length} unique physicians\n`);

  // ── Step 5: match ─────────────────────────────────────────────────────────
  console.log("🔍  Matching senders to physicians…");
  const results = [];

  for (const { name, email, count } of senderMap.values()) {
    const query = name || email.split("@")[0];
    let best = null;
    for (const physician of physicians) {
      const sim = similarity(query, physician.fullName);
      if (sim > (best?.similarity ?? -1)) {
        best = { ...physician, similarity: sim };
        if (sim === 1.0) break;
      }
    }
    const matched = best && best.similarity >= THRESHOLD;
    results.push({
      sender_name      : name,
      sender_email     : email,
      email_count      : count,
      matched_physician: matched ? best.fullName   : "",
      department       : matched ? best.department : "",
      similarity       : best   ? best.similarity.toFixed(3) : "0.000",
      matched          : matched ? "yes" : "no",
    });
  }

  // sort: matched → unmatched, then by similarity desc
  results.sort((a, b) => {
    if (a.matched !== b.matched) return a.matched === "yes" ? -1 : 1;
    return parseFloat(b.similarity) - parseFloat(a.similarity);
  });

  // ── Step 6: write CSV ─────────────────────────────────────────────────────
  const COLS = ["sender_name", "sender_email", "email_count",
                "matched_physician", "department", "similarity", "matched"];
  const lines = [COLS.join(","), ...results.map(r => csvRow(COLS.map(c => r[c])))];
  writeFileSync(OUTPUT_PATH, lines.join("\n") + "\n", "utf8");

  const matchedCount = results.filter(r => r.matched === "yes").length;
  console.log(`\n${"═".repeat(56)}`);
  console.log(`  ✅  ${matchedCount} matched  /  ${results.length} total senders`);
  console.log(`  📄  CSV → ${OUTPUT_PATH}`);
  console.log(`${"═".repeat(56)}\n`);
}

main().catch(err => {
  console.error("\n❌ Fatal:", err.message);
  process.exit(1);
});
