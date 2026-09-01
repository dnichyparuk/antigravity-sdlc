#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDLC_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIB="$SDLC_ROOT/scripts/lib/openspec.js"
[ ! -f "$LIB" ] && { echo "ERROR: Could not locate openspec.js." >&2; exit 2; }
node -e "
const { validateChangeStrict } = require('$LIB');
const result = validateChangeStrict(process.cwd(), process.argv[1]);
console.log(JSON.stringify(result));
" "$1"
