/**
 * scripts/score-tracker.mjs
 *
 * Monthly P4P score-completion tracker.
 * Triggered on the 1st of every month by GitHub Actions.
 *
 * Logic:
 *  Phase 1 — Per-department catch-up scan: walk a rolling window of months
 *             oldest → newest, and select the department's not-yet-sent
 *             months that are complete, stopping at the first month that's
 *             still incomplete (see selectMonthsToSend). This means a
 *             department only gets emailed once a given month is actually
 *             complete — never for a month that's still missing scores —
 *             and a department that falls behind still gets caught up
 *             automatically once it finishes, instead of needing a manual
 *             one-off resend (see scripts/resend-month.mjs).
 *  Phase 2 — Group by head email: departments sharing the same head email are
 *             batched into ONE email (one email per person, not per department).
 *  Phase 3 — Send: one email per unique address, reporting only the month(s)
 *             newly selected in Phase 1.
 *
 * Required env vars (GitHub Secrets):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   SUPABASE_URL, SUPABASE_KEY
 *
 * Department → head email comes from the Supabase dept_heads table (RLS
 * locked to service_role — see sql/dept_heads.sql), not a GitHub secret:
 * heads change often, and secrets are write-only, so a table you can read
 * and edit a single row of beats re-pasting a whole JSON blob each time.
 */

import { createClient }          from "@supabase/supabase-js";
import { config as dotenvConfig } from "dotenv";
import { appendFileSync }        from "fs";
import { createGmailClient }     from "../gmail-client.js";
import { createDriveClient }     from "../drive-client.js";
import { buildScoreReportEmail } from "../templates/score-report-email.js";
import { getDeptHeads }          from "../supabase-client.js";

dotenvConfig({ override: true });

// ── Configuration ─────────────────────────────────────────────────────────
const EXEMPT_DEPTS = new Set(["INTERN"]);
// How far back to look for months a department hasn't been emailed for yet.
// Wider than the old fixed 3-month display window so a department that falls
// behind (submits weeks/months late) still gets caught up automatically.
const CATCHUP_WINDOW_MONTHS = 12;

// ── Test-mode overrides (manual workflow_dispatch only, see score-tracker.yml) ──
// Restrict to specific department(s) and/or redirect the email to a test
// address instead of the real dept head — lets you verify a real send
// end-to-end without touching a real department head's inbox. When
// TEST_EMAIL is set, the run never writes to email_sent_log, so it has no
// effect on the next real scheduled run.
const TEST_DEPT_FILTER    = (process.env.TEST_DEPT ?? "").split(",").map(s => s.trim()).filter(Boolean);
const TEST_EMAIL_OVERRIDE = process.env.TEST_EMAIL?.trim() || null;

// ── Thai locale data ───────────────────────────────────────────────────────
const THAI_MONTHS = {
  "01":"มกราคม","02":"กุมภาพันธ์","03":"มีนาคม","04":"เมษายน",
  "05":"พฤษภาคม","06":"มิถุนายน","07":"กรกฎาคม","08":"สิงหาคม",
  "09":"กันยายน","10":"ตุลาคม","11":"พฤศจิกายน","12":"ธันวาคม",
};
const THAI_MONTHS_SHORT = {
  "01":"ม.ค.","02":"ก.พ.","03":"มี.ค.","04":"เม.ย.",
  "05":"พ.ค.","06":"มิ.ย.","07":"ก.ค.","08":"ส.ค.",
  "09":"ก.ย.","10":"ต.ค.","11":"พ.ย.","12":"ธ.ค.",
};

// ── Date helpers ───────────────────────────────────────────────────────────

/** Most-recent-first list of the `count` calendar months before this one. */
function getPreviousMonths(count) {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  const result = [];
  for (let i = 0; i < count; i++) {
    if (--m === 0) { m = 12; y--; }
    result.push(`${y + 543}_${String(m).padStart(2, "0")}`);
  }
  return result; // most-recent first
}

function tableKeyToDisplay(key) {
  const [year, month] = key.split("_");
  return `${THAI_MONTHS[month] ?? month} ${year}`;
}

// monthKeys (any order) → abbreviated range, oldest to newest, e.g.
// "เม.ย. - มิ.ย. 69" (or "ธ.ค. 68 - ก.พ. 69" when it crosses a BE year).
function monthRangeShortLabel(monthKeys) {
  const sorted = [...monthKeys].sort();
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const [oldYear, oldMonth] = oldest.split("_");
  const [newYear, newMonth] = newest.split("_");
  const oldLabel = THAI_MONTHS_SHORT[oldMonth] ?? oldMonth;
  const newLabel = THAI_MONTHS_SHORT[newMonth] ?? newMonth;
  const oldYY = oldYear.slice(-2);
  const newYY = newYear.slice(-2);
  return oldYear === newYear
    ? (oldest === newest ? `${oldLabel} ${oldYY}` : `${oldLabel} - ${newLabel} ${newYY}`)
    : `${oldLabel} ${oldYY} - ${newLabel} ${newYY}`;
}

function todayThaiStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getDate()} ${THAI_MONTHS[m]} ${d.getFullYear() + 543}`;
}

// This workflow runs on GitHub Actions in a PUBLIC repo — never print or
// persist a full recipient address to console/$GITHUB_STEP_SUMMARY, both of
// which are publicly readable job output.
function maskEmail(email) {
  const [user, domain] = String(email ?? "").split("@");
  if (!domain) return "***";
  const masked = user.length <= 2 ? `${user[0] ?? "*"}*` : `${user[0]}${"*".repeat(user.length - 2)}${user.slice(-1)}`;
  return `${masked}@${domain}`;
}

// ── Selection logic (pure — covered by test/scoreTrackerCatchup.test.js) ───

/**
 * Given one department's window months ordered oldest → newest, pick the
 * ones that are ready to email this run: not already sent, and complete.
 * Stops at the first month that exists but is still incomplete — a later
 * month is never reported while an earlier one is still an outstanding gap,
 * so dept heads always see completions in chronological order. A month with
 * no data at all (status === null — the department wasn't tracked that
 * month) is skipped without blocking later months.
 *
 * @param {Array<{ key: string, status: { complete: boolean }|null }>} monthsAsc
 * @param {Set<string>} alreadySentKeys  month keys already logged as sent for this dept
 * @returns {Array<{ key: string, status: object }>}  months to send, oldest → newest
 */
export function selectMonthsToSend(monthsAsc, alreadySentKeys) {
  const toSend = [];
  for (const { key, status } of monthsAsc) {
    if (alreadySentKeys.has(key)) continue;
    if (status === null) continue;
    if (!status.complete) break;
    toSend.push({ key, status });
  }
  return toSend;
}

// ── Supabase helpers ───────────────────────────────────────────────────────
function createSB() {
  const { SUPABASE_URL, SUPABASE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function getDeptStatus(sb, tableKey, dept, driveFileMap = null) {
  const { data, error } = await sb
    .from(tableKey)
    .select("firstname, lastname, score")
    .eq("department", dept);
  if (error) {
    // A window that reaches back further than a department/table's history
    // is expected — treat "table doesn't exist" as "no data" rather than a
    // fatal error (same pattern as process/report.js's getSupabasePersons).
    if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)) return null;
    throw new Error(`[${tableKey}/${dept}] Supabase: ${error.message}`);
  }
  if (!data?.length) return null;

  const total   = data.length;
  const filled  = data.filter(r => r.score !== null).length;
  const missing = total - filled;

  // Sort: score DESC, nulls last
  const rows = [...data]
    .sort((a, b) => {
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    })
    .map(r => {
      const name = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
      return { name, score: r.score, driveFileId: driveFileMap?.get(name) ?? null };
    });

  const missingNames = rows.filter(r => r.score === null).map(r => r.name);
  return { total, filled, missing, complete: missing === 0, missingNames, rows };
}

async function getDistinctDepts(sb, tableKeys) {
  const deptSet = new Set();
  for (const key of tableKeys) {
    const { data, error } = await sb.from(key).select("department");
    if (error || !data) continue;
    for (const r of data) {
      if (r.department && !EXEMPT_DEPTS.has(r.department.trim())) deptSet.add(r.department.trim());
    }
  }
  return [...deptSet].sort();
}

// ── Send-log helpers (email_sent_log) ───────────────────────────────────────
// Prevents re-sending a department's report for a month it's already been
// emailed about, and leaves an audit trail of when each report went out.

/** Fetch every (department → Set<monthKey>) already sent within the window. */
async function getSentMonthsByDept(sb, monthKeys) {
  const { data, error } = await sb
    .from("email_sent_log")
    .select("table_name, department")
    .in("table_name", monthKeys);
  if (error) { console.warn(`⚠️  email_sent_log read failed: ${error.message}`); return new Map(); }
  const map = new Map();
  for (const { table_name, department } of data) {
    if (!map.has(department)) map.set(department, new Set());
    map.get(department).add(table_name);
  }
  return map;
}

async function logEmailSent(sb, tableKey, department) {
  const { error } = await sb
    .from("email_sent_log")
    .upsert(
      { table_name: tableKey, department, sent_at: new Date().toISOString() },
      { onConflict: "table_name,department", ignoreDuplicates: true }
    );
  if (error) console.warn(`⚠️  email_sent_log insert failed [${department}]: ${error.message}`);
}


// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const todayStr = todayThaiStr();

  console.log(`\n${"═".repeat(62)}`);
  console.log(`  P4P Score Tracker  —  ${todayStr}`);
  console.log(`  Catch-up window: last ${CATCHUP_WINDOW_MONTHS} months`);
  console.log(`${"═".repeat(62)}\n`);

  const monthsDesc = getPreviousMonths(CATCHUP_WINDOW_MONTHS); // most-recent first
  const monthsAsc  = [...monthsDesc].reverse();                // oldest first — scan order
  const sb         = createSB();
  const gmail      = createGmailClient();
  const DEPT_HEADS = await getDeptHeads();

  console.log(`📅  Window: ${tableKeyToDisplay(monthsAsc[0])} → ${tableKeyToDisplay(monthsAsc[monthsAsc.length - 1])}\n`);

  // ── Build Drive file maps (one API call per month, shared across all depts)
  const drive = process.env.P4P_FOLDER_ID ? createDriveClient() : null;
  const driveFileMaps = new Map(); // tableKey → Map<physicianName, fileId>
  if (drive) {
    for (const key of monthsAsc) {
      try {
        const fileMap = await drive.listMonthFiles(key);
        driveFileMaps.set(key, fileMap);
      } catch (e) {
        console.warn(`⚠️  Drive lookup failed for ${key}: ${e.message}`);
      }
    }
    console.log();
  }

  let depts = await getDistinctDepts(sb, monthsDesc);
  if (!depts.length) { console.log("⚠️  No departments found — nothing to do."); return; }

  if (TEST_DEPT_FILTER.length) {
    depts = depts.filter(d => TEST_DEPT_FILTER.includes(d));
    console.log(`🧪  TEST MODE — dept filter: ${TEST_DEPT_FILTER.join(", ")}`);
    if (TEST_EMAIL_OVERRIDE) console.log(`🧪  TEST MODE — recipient override: ${maskEmail(TEST_EMAIL_OVERRIDE)} (email_sent_log will NOT be updated)`);
    if (!depts.length) { console.log("⚠️  No matching department(s) found — nothing to do."); return; }
  }
  console.log(`🏥  Departments: ${depts.join(", ")}\n`);

  const sentByDept = await getSentMonthsByDept(sb, monthsAsc);

  // ── Phase 1: per-department catch-up scan ───────────────────────────────
  // deptToSend: dept → [{ key, displayName, status }] (only newly-complete,
  // not-yet-sent months — oldest → newest)
  const deptToSend = new Map();
  const blockedNote = new Map(); // dept → note for depts with nothing to send this run

  for (const dept of depts) {
    console.log(`┌─ ${dept}`);
    const alreadySent = sentByDept.get(dept) ?? new Set();

    const monthsWithStatus = [];
    for (const key of monthsAsc) {
      const status = await getDeptStatus(sb, key, dept, driveFileMaps.get(key) ?? null);
      monthsWithStatus.push({ key, status });
    }

    for (const { key, status } of monthsWithStatus) {
      const sentTag = alreadySent.has(key) ? " (ส่งแล้ว)" : "";
      const icon = !status ? "—" : status.complete ? "✓" : `✗ ค้าง ${status.missing}/${status.total}`;
      console.log(`│   ${tableKeyToDisplay(key)}: ${icon}${sentTag}`);
    }

    const toSend = selectMonthsToSend(monthsWithStatus, alreadySent);

    if (toSend.length > 0) {
      console.log(`└─ พร้อมส่ง: ${toSend.map(m => tableKeyToDisplay(m.key)).join(", ")}\n`);
      deptToSend.set(dept, toSend.map(({ key, status }) => ({ key, displayName: tableKeyToDisplay(key), status })));
    } else {
      // Explain why nothing's going out. selectMonthsToSend skips null-status
      // (no data) months without blocking, so the real gap — if any — is the
      // oldest unsent month that actually HAS data (mirrors its own logic;
      // a plain "oldest unsent" would wrongly blame a no-data month instead).
      const anyUnsent = monthsWithStatus.some(({ key }) => !alreadySent.has(key));
      const oldestUnsentWithData = monthsWithStatus.find(({ key, status }) => !alreadySent.has(key) && status !== null);
      const note = !anyUnsent
        ? "ส่งครบแล้วทุกเดือนในช่วงที่ตรวจสอบ"
        : !oldestUnsentWithData
          ? "ไม่มีข้อมูลใหม่"
          : `รอข้อมูลให้ครบ (${tableKeyToDisplay(oldestUnsentWithData.key)} ค้าง ${oldestUnsentWithData.status.missing}/${oldestUnsentWithData.status.total})`;
      blockedNote.set(dept, note);
      console.log(`└─ ไม่มีเดือนใหม่ที่พร้อมส่ง — ${note}\n`);
    }
  }

  // ── Phase 2: group departments-with-something-to-send by head email ─────
  const byEmail = new Map();
  const noEmail = [];

  for (const [dept, monthsData] of deptToSend) {
    const email = TEST_EMAIL_OVERRIDE ?? ((DEPT_HEADS[dept] ?? DEPT_HEADS[dept.trim()]) ?? null);
    if (!email) {
      console.log(`⚠️  "${dept}": ไม่มีอีเมลหัวหน้า — ข้ามการส่ง`);
      noEmail.push(dept);
      continue;
    }
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push({ dept, monthsData });
  }

  // ── Phase 3: send one email per unique address ──────────────────────────
  const summaryRows = [];

  for (const [email, deptList] of byEmail) {
    const deptNames = deptList.map(d => d.dept).join(", ");
    const monthKeysInBatch = [...new Set(deptList.flatMap(d => d.monthsData.map(m => m.key)))];
    const monthLabel = monthRangeShortLabel(monthKeysInBatch);

    console.log(`\n📧  ${maskEmail(email)}`);
    console.log(`    กลุ่มงาน: ${deptNames}`);
    console.log(`    เดือนที่รายงาน: ${monthKeysInBatch.map(tableKeyToDisplay).join(", ")}`);

    const introText = `ระบบตรวจสอบและยืนยันว่าการส่งคะแนน P4P ของเดือน ` +
      `${monthKeysInBatch.map(tableKeyToDisplay).join(", ")} เสร็จสมบูรณ์ครบถ้วนแล้ว ` +
      `กดชื่อแพทย์เพื่อเปิดไฟล์ Excel บน Google Drive`;

    const html = buildScoreReportEmail({
      depts: deptList.map(d => ({ dept: d.dept, monthsSummary: d.monthsData })),
      reportDate: todayStr,
      intro: introText,
    });

    const subjectPrefix = TEST_EMAIL_OVERRIDE ? "[TEST] " : "";
    const subject   = `${subjectPrefix}รายงานคะแนน P4P ของกลุ่มงาน ${deptNames} เดือน ${monthLabel} (ครบถ้วน)`;
    const plainBody = `รายงานคะแนน P4P — เดือน ${monthKeysInBatch.map(tableKeyToDisplay).join(", ")}\nกลุ่มงาน: ${deptNames}`;

    await gmail.sendMessage({ to: email, subject, body: plainBody, html });
    console.log(`    ✉️  ส่งแล้ว`);

    for (const { dept, monthsData } of deptList) {
      if (!TEST_EMAIL_OVERRIDE) {
        for (const { key } of monthsData) {
          await logEmailSent(sb, key, dept);
        }
      }
      summaryRows.push({ dept, emailed: true, note: `ส่งแล้ว (${monthsData.map(m => m.displayName).join(", ")})${TEST_EMAIL_OVERRIDE ? " [TEST]" : ""}` });
    }
  }

  for (const dept of noEmail) {
    summaryRows.push({ dept, emailed: false, note: "ไม่มีอีเมลหัวหน้า" });
  }

  for (const [dept, note] of blockedNote) {
    summaryRows.push({ dept, emailed: false, note });
  }

  writeSummary(summaryRows, monthsAsc, todayStr);
}

// ── Step summary helper ────────────────────────────────────────────────────
function writeSummary(rows, monthsAsc, todayStr) {
  let md = `# 📈 P4P Score Tracker\n\n`;
  md += `**วันที่:** ${todayStr}  \n`;
  md += `**ช่วงที่ตรวจสอบ:** ${tableKeyToDisplay(monthsAsc[0])} – ${tableKeyToDisplay(monthsAsc[monthsAsc.length - 1])}\n\n`;

  if (!rows.length) {
    md += "_ไม่พบกลุ่มงานในช่วงนี้_\n";
  } else {
    md += `| กลุ่มงาน | ส่งอีเมล | หมายเหตุ |\n`;
    md += `|---|:---:|---|\n`;
    for (const r of rows) {
      md += `| ${r.dept} | ${r.emailed ? "✅" : "—"} | ${r.note} |\n`;
    }
  }

  md += `\n---\n_Run at ${new Date().toISOString()}_\n`;

  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) { appendFileSync(path, md, "utf8"); console.log("\n📊 Step summary written"); }
  else       { console.log("\n" + md); }
}

// Only run when invoked directly (so tests can import selectMonthsToSend etc.)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("\n❌ Fatal:", err.message);
    process.exit(1);
  });
}
