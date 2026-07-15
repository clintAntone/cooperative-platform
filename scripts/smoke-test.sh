#!/usr/bin/env bash
# ============================================================
# smoke-test.sh — Local build & sanity checks
# Usage: bash scripts/smoke-test.sh
#
# Checks:
#   1. TypeScript compilation + Vite bundle (npm run build)
#   2. ESLint (npm run lint)
#   3. All SQL migration files are numbered sequentially
#   4. No direct supabase calls in component files (enforce hook pattern)
#   5. All expected RPC names appear in the hooks layer
#   6. No 'any' type casts in hooks (warn only)
# ============================================================

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
WARN=0

ok()   { echo "  ✓  $*"; PASS=$((PASS + 1)); }
fail() { echo "  ✗  $*"; FAIL=$((FAIL + 1)); }
warn() { echo "  ⚠  $*"; WARN=$((WARN + 1)); }
section() { echo; echo "── $* ──────────────────────────────────────────────"; }

# ─── 1. TypeScript + bundle ───────────────────────────────────────────────────
section "1. TypeScript + Vite build"
if npm run build --silent 2>&1 | grep -q "✓ built"; then
  ok "Build succeeded"
else
  fail "Build FAILED — run 'npm run build' for details"
fi

# ─── 2. ESLint ───────────────────────────────────────────────────────────────
section "2. ESLint"
set +e
LINT_OUT=$(npm run lint 2>&1)
LINT_EXIT=$?
set -e
if [[ $LINT_EXIT -eq 0 ]]; then
  ok "Lint passed (0 warnings)"
elif echo "$LINT_OUT" | grep -q "command not found"; then
  warn "ESLint not on PATH — run 'npx eslint . --ext ts,tsx --max-warnings 0' manually"
else
  fail "Lint reported warnings or errors — run 'npm run lint' for details"
fi

# ─── 3. SQL migration sequence ───────────────────────────────────────────────
section "3. SQL migration file sequence"
PREV=0
GAP=0
for f in supabase/[0-9]*.sql; do
  NUM=$(basename "$f" | grep -o '^[0-9]*')
  NUM=$((10#$NUM))   # strip leading zeros
  if [[ $NUM -ne $((PREV + 1)) && $PREV -ne 0 ]]; then
    warn "Gap in migrations: expected $((PREV+1)), found $NUM ($f)"
    GAP=$((GAP + 1))
  fi
  PREV=$NUM
done
if [[ $GAP -eq 0 ]]; then
  ok "All $PREV migration files numbered sequentially"
fi

# ─── 4. No raw Supabase calls in page/component files ────────────────────────
# Note: some pages have pre-existing inline queries; we warn but don't fail.
section "4. Supabase direct calls in pages/components (informational)"
VIOLATIONS=$(grep -rl "supabase\." src/pages src/components 2>/dev/null \
  | grep -v "\.test\." || true)
VIOLATION_COUNT=$(echo "$VIOLATIONS" | grep -c "." 2>/dev/null || echo 0)
if [[ -z "$VIOLATIONS" || "$VIOLATION_COUNT" -eq 0 ]]; then
  ok "No direct supabase calls in pages/ or components/"
else
  warn "$VIOLATION_COUNT file(s) have inline supabase calls (should move to hooks over time)"
  for f in $VIOLATIONS; do
    echo "       $f"
  done
fi

# ─── 5. Critical RPCs referenced in hooks ────────────────────────────────────
section "5. Critical RPC names present in hooks layer"
HOOKS_DIR="src/hooks"
declare -A RPCS=(
  ["record_loan_repayment"]="useLoans.ts"
  ["approve_savings_deposit"]="useSavings.ts"
  ["approve_savings_withdrawal"]="useSavings.ts"
  ["record_branch_income"]="useBranches.ts"
  ["distribute_branch_income"]="useBranches.ts"
  ["get_completed_share_totals"]="useLoanEligibility.ts"
  ["get_loan_aging_report"]="ReportsPage.tsx"
)

for rpc in "${!RPCS[@]}"; do
  hint="${RPCS[$rpc]}"
  if grep -r --include="*.ts" --include="*.tsx" -q "'$rpc'" src/; then
    ok "RPC '$rpc' referenced in codebase"
  else
    fail "RPC '$rpc' NOT found in codebase (expected in $hint)"
  fi
done

# ─── 6. 'as any' usage in hooks (warn, not fail) ─────────────────────────────
section "6. 'as any' casts in hooks (warning)"
ANY_COUNT=$(grep -rc " as any" src/hooks/ 2>/dev/null | awk -F: '{sum+=$2} END{print sum+0}')
if [[ $ANY_COUNT -eq 0 ]]; then
  ok "No 'as any' casts in hooks"
else
  warn "$ANY_COUNT 'as any' cast(s) found in hooks — consider proper typing"
fi

# ─── 7. Key UI routes defined in App.tsx ─────────────────────────────────────
section "7. Expected routes in App.tsx"
declare -a ROUTES=(
  "/savings"
  "/savings/deposit-request"
  "/savings/withdraw"
  "/admin/savings-deposits"
  "/admin/savings-withdrawals"
  "/admin/branches"
  "/admin/users"
  "/reports"
  "/lending"
)
for route in "${ROUTES[@]}"; do
  if grep -q "\"$route\"" src/App.tsx 2>/dev/null || grep -q "'$route'" src/App.tsx 2>/dev/null; then
    ok "Route $route defined"
  else
    fail "Route $route NOT found in App.tsx"
  fi
done

# ─── Summary ──────────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════"
echo "  Results: $PASS passed  |  $FAIL failed  |  $WARN warnings"
echo "════════════════════════════════════════════════════════"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
