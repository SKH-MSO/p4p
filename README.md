# P4P

Monthly P4P (Pay-for-Performance) submission tracker for องค์กรแพทย์ โรงพยาบาลสมุทรสาคร,
delivered through a LINE Official Account. Doctors open the menu inside the LINE app and
see, per month, who has submitted, the full roster, and an on-time ranking.

## Architecture

```
LINE app ──► Rich menu / LIFF ──► 3 static pages (status / list / ranking)
                                        │
                    ┌───────────────────┼─────────────────────┐
                    ▼                    ▼                     ▼
              Supabase (rosters,   Express API (main.js)   Supabase
              submissions; read     GET /api/drive-files    (read via
              via anon key + RLS)   POST /line webhook      anon key + RLS)
                                        │
                                        ▼
                                  Google Drive (submitted files)
```

- **`main.js`** — Express app (deployed on Vercel as a serverless function).
  - `GET /api/drive-files?sheetname=YYYY_MM` — lists the files in that month's Drive folder.
  - `POST /line` — LINE Messaging API webhook (replies to the `status` keyword).
  - Serves the three static pages and `/assets`.
- **`status/`, `list/`, `ranking/`** — static LIFF pages. They read data **directly** from
  Supabase using the public anon key, so the data is protected by Row Level Security.
- **`assets/shared.js`** — constants/helpers shared by the three pages (Supabase config,
  month names, colors, HTML-escaping).
- **`src/constants.cjs`** — month/color constants shared by `main.js` and the rich-menu script.
- **`scripts/`** — one-off admin/build tooling (rich menus, feature cards, broadcasts). Not
  part of the deployed app.

## Environment variables

Copy `.env.example` to `.env` for local development, and set the same values in Vercel
(Project → Settings → Environment Variables). **Never commit `.env`.**

| Variable | Used by | Purpose |
| --- | --- | --- |
| `LINE_ACCESS_TOKEN` | `main.js` | LINE Messaging API channel access token |
| `LINE_CHANNEL_SECRET` | `main.js` | Verifies the `/line` webhook signature |
| `GOOGLE_CLIENT_ID` | `main.js` | Google OAuth (Drive) |
| `GOOGLE_CLIENT_SECRET` | `main.js` | Google OAuth (Drive) |
| `GOOGLE_REFRESH_TOKEN` | `main.js` | Google OAuth (Drive) |
| `DRIVE_ROOT_FOLDER_ID` | `main.js` | Root Drive folder holding the `YYYY/M - month` tree |
| `LINE_TOKEN` | `scripts/setup-richmenu.mjs`, `scripts/update-month-picker.mjs` | Rich-menu admin token |
| `LINE_USER_ID` | `scripts/send-test-flex.mjs` | Target user for a test push |

> `PORT` is only for local dev; Vercel provides it automatically.

## Local development

```bash
npm install
node main.js        # http://localhost:3000
```

## Deployment (Vercel)

Configured by `vercel.json` (the `@vercel/node` build of `main.js`). `main.js` exports the
Express `app` as the serverless handler and only calls `app.listen()` when run directly.
After deploying, point the LINE channel's webhook URL at `https://<your-domain>/line`.

## Supabase Row Level Security

The pages use the public anon key, so **RLS is the only thing protecting the data.** Run
`scripts/security-rls.sql` in the Supabase SQL editor to enable RLS, grant the anon role
read-only access to the specific columns the pages need, and block all anonymous writes.
See the header of that file for details.

## Scripts

```bash
node scripts/build-cards.mjs [version]     # render feature-card PNGs + Flex JSON (default v1)
node scripts/setup-richmenu.mjs            # create main + month-picker rich menus (needs LINE_TOKEN)
node scripts/update-month-picker.mjs       # refresh just the month-picker menu (needs LINE_TOKEN)
node scripts/broadcast-flex.mjs [version]  # broadcast the feature carousel to all followers
node scripts/send-test-flex.mjs [version]  # push the carousel to LINE_USER_ID
```

## Linting / formatting

```bash
npm run lint        # ESLint (main.js, scripts, assets)
npm run format      # Prettier --write
```
