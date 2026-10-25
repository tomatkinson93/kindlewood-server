#!/usr/bin/env bash
# scripts/test_all.sh — run every server test (and the frontend proofs, when
# the frontend checkout sits next to this one) against a THROWAWAY database
# and a running server. Prints one line per suite and a total; exits 1 if
# anything failed.
#
#   DATABASE_URL=postgres://… TEST_BASE=http://localhost:3999 TEST_ADMIN_ID=990001 scripts/test_all.sh
#
# The server must run with TEST_ADMIN_ID in ADMIN_USER_IDS. Run
# scripts/prepare_test_db.js once on a fresh database first.
set -u
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL (throwaway database)}"
BASE="${TEST_BASE:-http://localhost:3000}"
ADMIN="${TEST_ADMIN_ID:-}"
FE="${KW_FRONTEND_DIR:-../kindlewood-frontend}"
export CAREERS_TEST_BASE="$BASE" CRAFTING_TEST_BASE="$BASE" MARKET_TEST_BASE="$BASE" TRAVEL_TEST_BASE="$BASE" \
       CLAN_TEST_BASE="$BASE" QUEST_TEST_BASE="$BASE" KW_FRONTEND_DIR="$FE" \
       CRAFTING_TEST_ADMIN_ID="$ADMIN" MARKET_TEST_ADMIN_ID="$ADMIN" CLAN_TEST_ADMIN_ID="$ADMIN" \
       ADMIN_USER_IDS="${ADMIN_USER_IDS:-$ADMIN}"
fails=0; total_p=0; total_f=0
run() {   # label, command…
  local label="$1"; shift
  local out; out="$(timeout 300 "$@" 2>&1)"; local code=$?
  local line; line="$(printf '%s\n' "$out" | grep -E '[0-9]+ passed, [0-9]+ failed' | tail -1)"
  local p f; p="$(printf '%s' "$line" | grep -oE '^[^0-9]*[0-9]+' | grep -oE '[0-9]+$')"; f="$(printf '%s' "$line" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+')"
  total_p=$((total_p + ${p:-0})); total_f=$((total_f + ${f:-0}))
  if [ "$code" -ne 0 ] || [ "${f:-0}" -ne 0 ]; then fails=$((fails + 1)); printf '✘ %-28s %s\n' "$label" "${line:-exit $code}"; printf '%s\n' "$out" | grep -E 'FAIL|✘|Error' | head -5 | sed 's/^/    /'
  else printf '✔ %-28s %s\n' "$label" "${line:-ok}"; fi
}
for t in scripts/*_test.js; do run "$(basename "$t" .js)" node "$t"; done
if [ -d "$FE/verify" ]; then
  # Proofs read their files relative to the frontend root.
  for v in "$FE"/verify/*_proofs.js; do run "fe/$(basename "$v" .js)" bash -c 'cd "$1" && node "verify/$2"' _ "$FE" "$(basename "$v")"; done
fi
echo "──"
echo "$total_p passed, $total_f failed; $fails suite(s) not green"
[ "$fails" -eq 0 ]
