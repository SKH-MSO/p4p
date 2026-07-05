/**
 * Diagnostic: lists EVERY item in a Drive month folder, unfiltered —
 * folders, trashed items, all mime types — to find items that
 * listMonthFiles() (drive-client.js) silently excludes.
 * Usage: TARGET_DATE=2569_04 node scripts/list-month-raw.mjs
 */

import { google } from "googleapis";
import { MONTH_FOLDER_NAMES } from "../months.js";

const TARGET_DATE = process.env.TARGET_DATE ?? "2569_04";

function createAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return client;
}

const auth = createAuthClient();
const drive = google.drive({ version: "v3", auth });

async function findFolder(name, parentId, extraQ = "") {
  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder'${extraQ}`,
    fields: "files(id, name, trashed)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files ?? [];
}

const rootId = process.env.P4P_FOLDER_ID;
const [yearStr, monthStr] = TARGET_DATE.split("_");
const monthFolderName = MONTH_FOLDER_NAMES[parseInt(monthStr, 10)];

console.log(`Root P4P folder: ${rootId}`);

const yearFolders = await findFolder(yearStr, rootId, " and trashed=false");
console.log(`Year folder "${yearStr}":`, yearFolders);
if (!yearFolders[0]) process.exit(1);

const monthFolders = await findFolder(monthFolderName, yearFolders[0].id, " and trashed=false");
console.log(`Month folder "${monthFolderName}":`, monthFolders);
if (!monthFolders[0]) process.exit(1);

const monthFolderId = monthFolders[0].id;

// List EVERYTHING, including trashed and folders
const res = await drive.files.list({
  q: `'${monthFolderId}' in parents`,
  fields: "files(id, name, mimeType, trashed, size, createdTime, modifiedTime)",
  pageSize: 1000,
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
});

const files = res.data.files ?? [];
console.log(`\nTotal raw items (unfiltered): ${files.length}\n`);

for (const f of files) {
  const flags = [
    f.mimeType === "application/vnd.google-apps.folder" ? "FOLDER" : null,
    f.trashed ? "TRASHED" : null,
  ].filter(Boolean).join(",");
  console.log(`${flags.padEnd(20)} ${f.name}  (${f.mimeType})`);
}
