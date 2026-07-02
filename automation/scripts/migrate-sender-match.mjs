/**
 * scripts/migrate-sender-match.mjs
 *
 * ONE-OFF migration: imports the old sender-physician-match.csv (previously
 * committed to the repo root) into the sender_physician_match Supabase table.
 * Run sql/sender_physician_match.sql in the Supabase SQL Editor first.
 *
 * Usage (from automation/, with the CSV still present at the repo root):
 *   node scripts/migrate-sender-match.mjs [path/to/sender-physician-match.csv]
 *
 * Environment variables:
 *   SUPABASE_URL, SUPABASE_KEY
 */

import { readFileSync } from "fs";
import { config as dotenvConfig } from "dotenv";
import { saveSenderMatch } from "../supabase-client.js";

dotenvConfig({ override: true });

const CSV_PATH = process.argv[2] ?? "../sender-physician-match.csv";

// Minimal RFC-4180 CSV line parser — handles quoted fields with embedded
// commas/quotes, matching the csvCell() escaping match-sender-emails.mjs used.
function parseCsvLine(line) {
  const cells = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { cells.push(cur); cur = ""; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  Migrate sender-physician-match.csv → Supabase");
  console.log(`${"═".repeat(60)}\n`);

  const lines = readFileSync(CSV_PATH, "utf8").trim().split("\n");
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });

  console.log(`📄  ${rows.length} rows read from ${CSV_PATH}\n`);

  let ok = 0, fail = 0;
  for (const row of rows) {
    try {
      await saveSenderMatch({
        senderEmail      : row.sender_email,
        senderDisplayName: row.sender_display_name,
        emailCount       : parseInt(row.email_count, 10) || 0,
        extractedName    : row.extracted_name,
        nameSource       : row.name_source,
        matchedPhysician : row.matched_physician,
        department       : row.department,
        similarity       : row.similarity,
        matched          : row.matched,
      });
      ok++;
    } catch (e) {
      fail++;
      console.warn(`⚠️  ${row.sender_email}: ${e.message}`);
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ✅  ${ok} migrated  /  ⚠️  ${fail} failed  /  ${rows.length} total`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("\n❌ Fatal:", err.message);
  process.exit(1);
});
