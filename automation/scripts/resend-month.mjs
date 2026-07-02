/**
 * scripts/resend-month.mjs
 *
 * ONE-OFF resend: physicians submitted missing March 2569 (2569_03) scores
 * after that month rolled out of the normal 3-month tracker window, so
 * score-tracker.mjs's regular monthly email no longer surfaces the updated
 * status. This reports on 2569_03 EXCLUSIVELY and resends to every
 * configured department head, regardless of that department's March
 * completeness (unlike score-tracker.mjs, this isn't filtered to only
 * incomplete departments).
 *
 * Usage (from automation/):
 *   node scripts/resend-month.mjs
 *
 * Required env vars (same as score-tracker.mjs):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   SUPABASE_URL, SUPABASE_KEY
 *   P4P_FOLDER_ID (optional — enables Drive file links)
 *
 * Department → head email comes from the Supabase dept_heads table (see
 * sql/dept_heads.sql), same as score-tracker.mjs.
 */

import { createClient }          from "@supabase/supabase-js";
import { config as dotenvConfig } from "dotenv";
import { appendFileSync }        from "fs";
import { createGmailClient }     from "../gmail-client.js";
import { createDriveClient }     from "../drive-client.js";
import { buildScoreReportEmail } from "../templates/score-report-email.js";
import { getDeptHeads }          from "../supabase-client.js";

dotenvConfig({ override: true });

const TARGET_MONTH = process.env.TARGET_MONTH ?? "2569_03";
const EXEMPT_DEPTS = new Set(["INTERN"]);

const THAI_MONTHS = {
  "01":"มกราคม","02":"กุมภาพันธ์","03":"มีนาคม","04":"เมษายน",
  "05":"พฤษภาคม","06":"มิถุนายน","07":"กรกฎาคม","08":"สิงหาคม",
  "09":"กันยายน","10":"ตุลาคม","11":"พฤศจิกายน","12":"ธันวาคม",
};

function tableKeyToDisplay(key) {
  const [year, month] = key.split("_");
  return `${THAI_MONTHS[month] ?? month} ${year}`;
}

function todayThaiStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getDate()} ${THAI_MONTHS[m]} ${d.getFullYear() + 543}`;
}

// This can run on GitHub Actions in a PUBLIC repo — never print or persist a
// full recipient address to console/$GITHUB_STEP_SUMMARY.
function maskEmail(email) {
  const [user, domain] = String(email ?? "").split("@");
  if (!domain) return "***";
  const masked = user.length <= 2 ? `${user[0] ?? "*"}*` : `${user[0]}${"*".repeat(user.length - 2)}${user.slice(-1)}`;
  return `${masked}@${domain}`;
}

function createSB() {
  const { SUPABASE_URL, SUPABASE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function getDeptStatus(sb, tableKey, dept, driveFileMap) {
  const { data, error } = await sb
    .from(tableKey)
    .select("firstname, lastname, score")
    .eq("department", dept);
  if (error) throw new Error(`[${tableKey}/${dept}] Supabase: ${error.message}`);
  if (!data?.length) return null;

  const total   = data.length;
  const filled  = data.filter(r => r.score !== null).length;
  const missing = total - filled;

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

async function getDistinctDepts(sb, tableKey) {
  const { data, error } = await sb.from(tableKey).select("department");
  if (error || !data) return [];
  const deptSet = new Set();
  for (const r of data) {
    if (r.department && !EXEMPT_DEPTS.has(r.department.trim())) deptSet.add(r.department.trim());
  }
  return [...deptSet].sort();
}

async function main() {
  const todayStr    = todayThaiStr();
  const monthDisplay = tableKeyToDisplay(TARGET_MONTH); // "มีนาคม 2569"

  console.log(`\n${"═".repeat(62)}`);
  console.log(`  P4P Score Tracker — ONE-OFF RESEND — ${monthDisplay}`);
  console.log(`  (Exclusively ${TARGET_MONTH} — not the usual 3-month window)`);
  console.log(`${"═".repeat(62)}\n`);

  const sb         = createSB();
  const gmail      = createGmailClient();
  const DEPT_HEADS = await getDeptHeads();

  const drive = process.env.P4P_FOLDER_ID ? createDriveClient() : null;
  let driveFileMap = null;
  if (drive) {
    try {
      driveFileMap = await drive.listMonthFiles(TARGET_MONTH);
      console.log(`📁  Drive ${monthDisplay}: ${driveFileMap.size} files\n`);
    } catch (e) {
      console.warn(`⚠️  Drive lookup failed for ${TARGET_MONTH}: ${e.message}\n`);
    }
  }

  const depts = await getDistinctDepts(sb, TARGET_MONTH);
  if (!depts.length) { console.log(`⚠️  No departments found for ${TARGET_MONTH} — nothing to do.`); return; }
  console.log(`🏥  Departments: ${depts.join(", ")}\n`);

  // ── Gather per-dept status for the single target month only ─────────────
  const deptData = new Map();
  for (const dept of depts) {
    const status = await getDeptStatus(sb, TARGET_MONTH, dept, driveFileMap);
    const icon = !status ? "—" : status.complete ? "✓" : `✗ ค้าง ${status.missing}/${status.total}`;
    console.log(`  ${dept}: ${icon}`);
    deptData.set(dept, [{ key: TARGET_MONTH, displayName: monthDisplay, status }]);
  }
  console.log();

  // ── Group departments by head email (same batching as score-tracker.mjs,
  //    but every department is included — not just incomplete ones) ────────
  const byEmail = new Map();
  const noEmail = [];
  for (const [dept, monthsData] of deptData) {
    const email = (DEPT_HEADS[dept] ?? DEPT_HEADS[dept.trim()]) ?? null;
    if (!email) { noEmail.push(dept); continue; }
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push({ dept, monthsData });
  }

  const introText = `ระบบได้รวบรวมสถานะการส่งคะแนน P4P ของเดือน ${monthDisplay} ` +
    `กดชื่อแพทย์เพื่อเปิดไฟล์ Excel บน Google Drive`;

  const summaryRows = [];
  for (const [email, deptList] of byEmail) {
    const deptNames = deptList.map(d => d.dept).join(", ");
    console.log(`\n📧  ${maskEmail(email)}`);
    console.log(`    กลุ่มงาน: ${deptNames}`);

    const html = buildScoreReportEmail({
      depts: deptList.map(d => ({ dept: d.dept, monthsSummary: d.monthsData })),
      reportDate: todayStr,
      intro: introText,
    });

    const subject   = `รายงานคะแนน P4P ของกลุ่มงาน ${deptNames} ประจำเดือน มี.ค. 69`;
    const plainBody = `รายงานคะแนน P4P ประจำเดือน ${monthDisplay}\nกลุ่มงาน: ${deptNames}`;

    await gmail.sendMessage({ to: email, subject, body: plainBody, html });
    console.log(`    ✉️  ส่งแล้ว`);

    for (const { dept } of deptList) summaryRows.push({ dept, emailed: true, note: "ส่งแล้ว" });
  }
  for (const dept of noEmail) summaryRows.push({ dept, emailed: false, note: "ไม่มีอีเมลหัวหน้า" });

  writeSummary(summaryRows, monthDisplay, todayStr);
}

function writeSummary(rows, monthDisplay, todayStr) {
  let md = `# 📈 P4P Score Tracker — One-off resend\n\n`;
  md += `**วันที่ส่ง:** ${todayStr}  \n`;
  md += `**เดือนที่ตรวจสอบ (เฉพาะ):** ${monthDisplay}\n\n`;

  if (!rows.length) {
    md += "_ไม่พบกลุ่มงานในเดือนนี้_\n";
  } else {
    md += `| กลุ่มงาน | ส่งอีเมล | หมายเหตุ |\n`;
    md += `|---|:---:|---|\n`;
    for (const r of rows) md += `| ${r.dept} | ${r.emailed ? "✅" : "—"} | ${r.note} |\n`;
  }

  md += `\n---\n_Run at ${new Date().toISOString()}_\n`;

  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) { appendFileSync(path, md, "utf8"); console.log("\n📊 Step summary written"); }
  else       { console.log("\n" + md); }
}

main().catch(err => {
  console.error("\n❌ Fatal:", err.message);
  process.exit(1);
});
