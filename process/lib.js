/**
 * process/lib.js
 *
 * Shared helpers used by both process.js (merge + SK03 pipeline) and
 * report.js (missing-submission tracker). Previously each script carried its
 * own near-identical copy of every function below; a fix applied to one copy
 * (e.g. the Drive query-string quote-escaping in uploadFileToDrive) had no
 * way to reach the other, so the two scripts silently drifted apart. This
 * module is now the single source of truth for the pieces that ARE meant to
 * behave identically — anything that legitimately differs between the two
 * scripts (e.g. their getTargetMonths() window) intentionally stays local.
 */

const { google } = require('googleapis');

// ═══════════════════════════════════════════════════════════════════
//  Logging / control flow
// ═══════════════════════════════════════════════════════════════════
function log(msg, level = 'info') {
  (level === 'warn' ? console.error : console.log)((level === 'warn' ? '⚠  ' : '') + msg);
}

/** ms delay */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Retry an async fn on Google quota (429) or server (5xx) errors.
 * Exponential backoff starting at 3 s, capped at 60 s.
 */
async function withRetry(fn, maxRetries = 7) {
  let delay = 3000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status   = err?.response?.status ?? err?.status ?? 0;
      const msg      = err?.message ?? '';
      const isQuota  = status === 429 || msg.includes('Quota exceeded') || msg.includes('RESOURCE_EXHAUSTED');
      const isServer = status >= 500 && status < 600;
      if ((isQuota || isServer) && attempt < maxRetries) {
        const wait = delay + Math.random() * 1000;
        log(`  [Retry] ${isQuota ? 'Quota' : 'Server'} — waiting ${(wait / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`, 'warn');
        await sleep(wait);
        delay = Math.min(delay * 2, 60000);
      } else {
        throw err;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  String helpers
// ═══════════════════════════════════════════════════════════════════
function stripExt(filename)  { return filename.replace(/\.(xlsx|xls)$/i, '').trim(); }
function normaliseName(name) { return (name ?? '').trim().replace(/\s+/g, ' '); }

// ═══════════════════════════════════════════════════════════════════
//  Google API clients
// ═══════════════════════════════════════════════════════════════════
function createAuth() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

function createDriveClient() {
  return google.drive({ version: 'v3', auth: createAuth() });
}

// ═══════════════════════════════════════════════════════════════════
//  Google Drive helpers
// ═══════════════════════════════════════════════════════════════════
async function driveListAll(drive, params) {
  const items = [];
  let pageToken;
  do {
    const res = await withRetry(() => drive.files.list({ ...params, pageToken }));
    items.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

async function listFolders(drive, parentId) {
  return driveListAll(drive, {
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'nextPageToken, files(id, name)', pageSize: 100,
  });
}

async function listExcelFiles(drive, folderId) {
  const mimes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ].map(m => `mimeType='${m}'`).join(' or ');
  return driveListAll(drive, {
    q: `'${folderId}' in parents and (${mimes}) and trashed=false`,
    fields: 'nextPageToken, files(id, name)', pageSize: 100,
  });
}

module.exports = {
  log, sleep, withRetry,
  stripExt, normaliseName,
  createAuth, createDriveClient,
  driveListAll, listFolders, listExcelFiles,
};
