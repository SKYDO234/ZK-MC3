#!/usr/bin/env bash
# =============================================================
#  scripts/check-shell.sh  ·  shell-script regression guard
# =============================================================
#  Catches the failure mode that broke `install.sh install`:
#  a ${VAR} referenced under `set -u` that is never assigned and has no
#  `:-default`, which aborts the script mid-run with
#  "VAR: unbound variable".
#
#  Usage:  bash scripts/check-shell.sh
# =============================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
STATUS=0

for file in install.sh update.sh uninstall.sh; do
  [ -f "$file" ] || continue
  printf '▸ %s\n' "$file"

  # 1. syntax
  if bash -n "$file" 2>/tmp/zk-shell-err; then
    printf '  ✔ syntax\n'
  else
    printf '  ✖ syntax error:\n'
    sed 's/^/      /' /tmp/zk-shell-err
    STATUS=1
  fi

  # 2. `set -u` safety — every ${VAR} must be assigned in the file or defaulted.
  if grep -qE '^set -[a-zA-Z]*u' "$file"; then
    report=$(python3 - "$file" <<'PY'
import re, sys
path = sys.argv[1]
src = open(path).read()

assigned = set(re.findall(r'(?:^|[\s;])(?:local\s+|export\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)=', src, re.M))
assigned |= set(re.findall(r'read\s+(?:-[a-zA-Z]+\s+)*(?:-p\s+"[^"]*"\s+)?([A-Za-z_][A-Za-z0-9_]*)', src))
# positional/special params and vars supplied by the caller's environment
assigned |= {'BASH_SOURCE', 'FUNCNAME', 'PIPESTATUS', 'RANDOM', 'SECONDS', 'LINENO'}

risky = []
for var in sorted(set(re.findall(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}', src))):
    if var in assigned:
        continue
    # a bare ${VAR} (no :- default) that we never assign is the hazard
    if re.search(r'\$\{' + re.escape(var) + r'\}', src):
        risky.append(var)

for var in risky:
    line = next((i + 1 for i, l in enumerate(src.split('\n')) if '${' + var + '}' in l), 0)
    print(f'{var}\t{line}')
PY
)
    if [ -n "$report" ]; then
      printf '  ✖ variables used but never assigned (set -u will abort):\n'
      printf '%s\n' "$report" | while IFS=$'\t' read -r var line; do
        printf '      %-16s line %s\n' "$var" "$line"
      done
      STATUS=1
    else
      printf '  ✔ no unset-variable hazards\n'
    fi
  fi
done

rm -f /tmp/zk-shell-err
[ "$STATUS" -eq 0 ] && printf '\nAll shell scripts look good.\n'
exit "$STATUS"
