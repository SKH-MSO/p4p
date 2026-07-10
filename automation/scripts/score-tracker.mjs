/**
 * scripts/score-tracker.mjs
 *
 * Monthly P4P score-completion tracker.
 * Runs as a job in .github/workflows/process-pipeline.yml, on that
 * workflow's daily schedule (no schedule of its own).
 *
 * Logic:
 *  Phase 1 — Per-department catch-up scan: walk a rolling window of months
 *             newest → oldest, skipping (not stopping at) incomplete or
 *             no-data months while searching for where a complete run
 *             starts (see selectMonthsToSend) — an in-progress newer month
 *             must never permanently block an older, already-complete one
 *             from being reported. Once a complete+unsent month is found,
 *             collect it and any further consecutive complete+unsent months
 *             behind it, up to MAX_MONTHS_PER_EMAIL, stopping at the first
 *             incomplete/no-data/already-sent gap.
 *  Phase 2 — Group by head email: departments sharing the same head email are
 *             batched into ONE email (one email per person, not per department).
 *  Phase 3 — Send: one email per unique address, reporting the month(s)
 *             selected per department in Phase 1. Never resend a month
 *             already logged in email_sent_log (tracked per department per
 *             month).
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

import { config as dotenvConfig } from "dotenv";
import { appendFileSync }        from "fs";
import { createGmailClient }     from "../gmail-client.js";
import { createDriveClient }     from "../drive-client.js";
import { buildScoreReportEmail } from "../templates/score-report-email.js";
import { getDeptHeads }          from "../supabase-client.js";
import { bangkokNow, todayThaiStr } from "../bangkok-date.js";
import { createSB, maskEmail, getDeptStatus } from "../dept-status.js";

dotenvConfig({ override: true });

// ── Configuration ─────────────────────────────────────────────────────────
const EXEMPT_DEPTS = new Set(["INTERN"]);
// How far back to search for where a department's complete-unsent run
// starts. Wide enough that a department with a long dry spell still gets
// found once it does complete a month — selectMonthsToSend skips
// incomplete/no-data months while searching rather than stopping at the
// first one, so widening this window is harmless on its own (the batch
// itself is separately bounded by MAX_MONTHS_PER_EMAIL below).
const CATCHUP_WINDOW_MONTHS = 12;
// Never scan earlier than this month key, even if it's within the window
// above — pre-existing history further back than this predates the
// tracker's cutover and is out of scope.
const CATCHUP_START_MONTH = "2569_04";
// Cap on how many consecutive complete-unsent months get bundled into a
// single email — keeps a large backlog (e.g. after an outage, or a manual
// email_sent_log reset) from producing one enormous email; the remainder
// gets picked up on the next run since only the sent months get logged.
const MAX_MONTHS_PER_EMAIL = 6;

// ── Test-mode overrides (manual workflow_dispatch only, see process-pipeline.yml) ──
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
  // Bangkok-safe: this workflow is cron'd for the 1st of the month, and a
  // raw `new Date()` reads the GitHub Actions runner's UTC clock — right at
  // the Bangkok midnight boundary that resolves to the wrong month.
  const { ceYear, month } = bangkokNow();
  let y = ceYear;
  let m = month;
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

// todayThaiStr is now imported from ../bangkok-date.js (Bangkok-safe; see
// the comment on getPreviousMonths above for why raw `new Date()` is unsafe
// here). maskEmail/createSB/getDeptStatus are now imported from
// ../dept-status.js (shared with resend-month.mjs).

// ── Selection logic (pure — covered by test/scoreTrackerCatchup.test.js) ───

/**
 * Given one department's window months ordered oldest → newest, find the
 * consecutive run of complete, unsent months to email this run.
 *
 * Two-phase walk, backwards (newest first):
 *  1. Searching — skip past incomplete, no-data, and already-sent months
 *     without stopping, until the first complete+unsent month is found.
 *     This is the key fix: an in-progress newer month (or a month already
 *     sent) must never permanently block an older, already-complete one
 *     from ever being reported.
 *  2. Collecting — once found, keep including consecutive complete+unsent
 *     months behind it, stopping at the first incomplete, no-data, or
 *     already-sent month (a genuine gap ends the run — it doesn't get
 *     skipped over), or once maxBatch entries have been collected.
 *
 * @param {Array<{ key: string, status: { complete: boolean }|null }>} monthsAsc
 * @param {Set<string>} alreadySentKeys  month keys already logged as sent for this dept
 * @param {number} [maxBatch]  cap on how many months one run will select
 * @returns {Array<{ key: string, status: object }>}  months to send, newest → oldest
 */
export function selectMonthsToSend(monthsAsc, alreadySentKeys, maxBatch = MAX_MONTHS_PER_EMAIL) {
  const monthsDesc = [...monthsAsc].reverse(); // newest first
  const toSend = [];

  for (const { key, status } of monthsDesc) {
    const eligible = status !== null && status.complete && !alreadySentKeys.has(key);

    if (toSend.length === 0) {
      if (!eligible) continue; // still searching — skip gaps, keep looking older
      toSend.push({ key, status });
      continue;
    }

    if (!eligible) break;      // already collecting — a gap ends the run here
    toSend.push({ key, status });
    if (toSend.length >= maxBatch) break;
  }

  return toSend; // newest → oldest
}

// createSB/getDeptStatus are now imported from ../dept-status.js.

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

// Failures collected here are surfaced in the step summary AND fail the run
// (see main()'s final check) — an email that sent successfully but whose
// "sent" log write silently failed would otherwise go unnoticed until the
// NEXT scheduled run resends the same report to the same department head.
const logSentFailures = [];

async function logEmailSent(sb, tableKey, department) {
  const upsertOnce = () => sb
    .from("email_sent_log")
    .upsert(
      { table_name: tableKey, department, sent_at: new Date().toISOString() },
      { onConflict: "table_name,department", ignoreDuplicates: true }
    );

  let { error } = await upsertOnce();
  if (error) {
    console.warn(`⚠️  email_sent_log insert failed [${department}/${tableKey}], retrying once: ${error.message}`);
    ({ error } = await upsertOnce());
  }
  if (error) {
    console.error(`❌  email_sent_log insert failed twice [${department}/${tableKey}]: ${error.message} — the report WAS emailed, but this run will not remember that, risking a duplicate send next time.`);
    logSentFailures.push({ tableKey, department, message: error.message });
  }
}


// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const todayStr = todayThaiStr();

  console.log(`\n${"═".repeat(62)}`);
  console.log(`  P4P Score Tracker  —  ${todayStr}`);
  console.log(`  Catch-up window: last ${CATCHUP_WINDOW_MONTHS} months, not before ${tableKeyToDisplay(CATCHUP_START_MONTH)}`);
  console.log(`${"═".repeat(62)}\n`);

  // most-recent first, floored at CATCHUP_START_MONTH so older stale gaps
  // (e.g. a month stuck at 0 submissions from before the tracker's cutover)
  // can't permanently block every later completed month
  const monthsDesc = getPreviousMonths(CATCHUP_WINDOW_MONTHS).filter(key => key >= CATCHUP_START_MONTH);
  const monthsAsc  = [...monthsDesc].reverse();                // oldest first — scan order
  if (!monthsAsc.length) { console.log(`⚠️  No months in range (CATCHUP_START_MONTH ${CATCHUP_START_MONTH} is outside the ${CATCHUP_WINDOW_MONTHS}-month window) — nothing to do.`); return; }
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
  // deptToSend: dept → [{ key, displayName, status }] (0..MAX_MONTHS_PER_EMAIL
  // entries — the department's consecutive complete, not-yet-sent months)
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
      // Explain why nothing's going out. selectMonthsToSend never stops
      // searching at an incomplete/already-sent month anymore, so there are
      // only two possible reasons: no complete month exists anywhere in the
      // window, or every complete month found was already sent. (A third
      // outcome — some complete+unsent month existing but not selected —
      // would mean toSend wasn't empty, so it can't reach here; log loudly
      // if it ever does, since that'd indicate a bug.)
      const anyComplete       = monthsWithStatus.some(({ status }) => status?.complete);
      const anyUnsentComplete = monthsWithStatus.some(({ key, status }) => status?.complete && !alreadySent.has(key));
      const note = !anyComplete
        ? "ยังไม่มีเดือนใดครบถ้วนในช่วงที่ตรวจสอบ"
        : !anyUnsentComplete
          ? "ส่งครบแล้วทุกเดือนที่ครบถ้วนในช่วงที่ตรวจสอบ"
          : "⚠ unexpected: a complete+unsent month exists but was not selected — check selectMonthsToSend";
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

  if (logSentFailures.length > 0) {
    // Fail the run loudly (non-zero exit → red in GitHub Actions) instead of
    // letting a swallowed email_sent_log write pass as a green run — the
    // report already went out, but without this the next scheduled run has
    // no way to know that and will resend it.
    throw new Error(
      `${logSentFailures.length} email_sent_log write(s) failed after retry — ` +
      logSentFailures.map(f => `${f.department}/${f.tableKey} (${f.message})`).join("; ")
    );
  }
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

  if (logSentFailures.length > 0) {
    md += `\n## ⚠️ email_sent_log write failures\n\n`;
    md += `These reports were emailed successfully, but recording that fact failed twice — `;
    md += `they may be resent next run unless fixed manually:\n\n`;
    md += `| Department | Month | Error |\n|---|---|---|\n`;
    for (const f of logSentFailures) {
      md += `| ${f.department} | ${f.tableKey} | ${f.message.replace(/\|/g, "╎")} |\n`;
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
