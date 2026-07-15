#!/usr/bin/env bash
# Deletes remote branches that have been verified as fully merged into main.
# Run from a machine with push access to SKH-MSO/p4p.
#
# Verification performed (2026-07-15):
#   - claude/code-review-architecture-q2kvgh   fully contained in main
#   - claude/email-verification-gate-a9cttq    fully contained in main
#   - claude/github-workflows-list-0z0zfg      fully contained in main
#   - claude/google-drive-file-count-56zp91    fully contained in main
#   - claude/monthly-p4p-score-tracker-77xhx0  fully contained in main
#   - claude/p4p-head-of-dept-list-0nb4yl      fully contained in main
#   - claude/supabase-tables-overview-sc9ls1   fully contained in main
#   - claude/telegram-email-fullname-fifv82    fully contained in main
#   - supabase-auth                            fully contained in main
#   - claude/email-sent-log-purpose-17co8w     squash-merged PR #34, base main, no later commits
#   - claude/github-workflows-access-o9gjhv    squash-merged PR #31/#32, base main, no later commits
#   - claude/july-button-ranking-display-h3lt9r squash-merged PR #10-#29, base main, no later commits
#   - claude/p4p-tracker-completed-months-0s0vj1 squash-merged PR #65, base main, no later commits
#   - claude/supabase-2569-07-rls-a6dm00       squash-merged PR #35-#39, base main, no later commits
#   - merge-automation                         squash-merged PR #1, base main, no later commits
#
# Branches deliberately KEPT (do not add to this script without re-checking):
#   - main, verification (excluded by request)
#   - never merged (no PR): claude/2569-02-status-index-sender-xgk76n,
#     claude/carousel-v1-verify-ah7xcl, claude/stoic-galileo-kufvll,
#     claude/supabase-db-access-j7r40w, claude/tg-msg-layout-email-extract-76j713
#   - open PRs: claude/v2-carousel-identity-verify-2nmeu5 (#80),
#     dependabot/npm_and_yarn/automation/anthropic-ai/sdk-0.111.0 (#92),
#     dependabot/npm_and_yarn/automation/dotenv-17.4.2 (#7),
#     dependabot/npm_and_yarn/automation/googleapis-173.0.0 (#8),
#     dependabot/npm_and_yarn/automation/supabase/supabase-js-2.110.2 (#91)
#   - merged but has commits pushed AFTER the merge (deleting would lose work):
#     claude/amazing-darwin-iv4al5 (PR #9 closed unmerged),
#     claude/unused-github-workflows-2l6a02 (commits ~9h after its only merge, no later PR)

set -euo pipefail

git push origin --delete \
  claude/code-review-architecture-q2kvgh \
  claude/email-verification-gate-a9cttq \
  claude/github-workflows-list-0z0zfg \
  claude/google-drive-file-count-56zp91 \
  claude/monthly-p4p-score-tracker-77xhx0 \
  claude/p4p-head-of-dept-list-0nb4yl \
  claude/supabase-tables-overview-sc9ls1 \
  claude/telegram-email-fullname-fifv82 \
  supabase-auth \
  claude/email-sent-log-purpose-17co8w \
  claude/github-workflows-access-o9gjhv \
  claude/july-button-ranking-display-h3lt9r \
  claude/p4p-tracker-completed-months-0s0vj1 \
  claude/supabase-2569-07-rls-a6dm00 \
  merge-automation
