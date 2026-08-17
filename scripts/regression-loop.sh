#!/usr/bin/env bash
# Phase 18 final regression loop — every test file, tallied.
cd /workspace
set +e
export $(grep -E '^(QASE_API_TOKEN|QASE_API_KEY|QASE_MODEL|QASE_PROVIDER|QASE_MAX_TURNS|QASE_FIX_VALIDATION_ATTEMPTS)=' .env | xargs)
total_pass=0; total_fail=0; total_cancel=0; failed_suites=(); done_n=0
for f in tests/*.test.js; do
  out=$(node --test "$f" 2>&1)
  p=$(grep -E '^# pass ' <<<"$out" | awk '{print $3}'); f_=$(grep -E '^# fail ' <<<"$out" | awk '{print $3}'); c=$(grep -E '^# cancelled ' <<<"$out" | awk '{print $4}')
  [ -z "$p" ] && p=0; [ -z "$f_" ] && f_=0; [ -z "$c" ] && c=0
  total_pass=$((total_pass+p)); total_fail=$((total_fail+f_)); total_cancel=$((total_cancel+c))
  if [ "$f_" != "0" ] || [ "$c" != "0" ]; then failed_suites+=("$f (fail=$f_ cancel=$c)"); fi
  done_n=$((done_n+1))
  echo "[$done_n] $f → pass=$p fail=$f_ cancel=$c"
done
echo "══════════════════════════════════════"
echo "SUITES=$done_n TOTAL_PASS=$total_pass TOTAL_FAIL=$total_fail TOTAL_CANCEL=$total_cancel"
if [ ${#failed_suites[@]} -gt 0 ]; then printf 'NONCLEAN: %s\n' "${failed_suites[@]}"; else echo "ALL CLEAN"; fi
