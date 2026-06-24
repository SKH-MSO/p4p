# P4P

Monthly P4P (Pay-for-Performance) submission tracker for องค์กรแพทย์ โรงพยาบาลสมุทรสาคร,
delivered through a LINE Official Account. Doctors open the menu inside the LINE app and
see, per month, who has submitted, the full roster, and an on-time ranking.

## Architecture

```
                       P4P submission emails (Gmail)
                                  │
                                  ▼
            sakhonmso/automation — scheduled GitHub Action
            extracts { name, month, score } and writes
            score + submitted_at onto the month-table row
                                  │ writes (service role)
                                  ▼
LINE app ─► Rich menu / LIFF ─► status / list / ranking ──read──► Supabase YYYY_MM
                       │         (static LIFF pages)      (anon)   month tables
                       └───────► POST /line (main.js, Vercel)      (roster + score
                                                                    + submitted_at)
```

"Submitted" = `submitted_at IS NOT NULL`. All three pages read the same month tables.

- **`main.js`** — Express app (deployed on Vercel as a serverless function).
  - `POST /line` — LINE Messaging API webhook (replies to the `status` keyword).
  - Serves the three static pages and `/assets`.
- **`status/`, `list/`, `ranking/`** — static LIFF pages. They read the `YYYY_MM` month
  tables **directly** from Supabase via the public anon key (protected by RLS). status shows
  submitted vs pending, ranking orders the submitted ones by `submitted_at` (on-time only).
- **Submission data** comes from a separate repo, **`sakhonmso/automation`** (a scheduled
  GitHub Action): it reads P4P emails, extracts doctor/month/score, and writes `score` +
  `submitted_at` onto that month's row. This app only *reads* that data.
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
`scripts/security-rls.sql` in the Supabase SQL editor to enable RLS, add the `submitted_at`
column to each month table, grant the anon role read-only access to the columns the pages
need, and block all anonymous writes. To carry historical submission times over from the old
`p4p_submissions` table, run `scripts/backfill-submitted-at.sql` once afterwards. See the
header of each file for details.

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
