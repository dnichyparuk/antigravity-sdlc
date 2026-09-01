#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDLC_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

LINKS_LIB="$SDLC_ROOT/scripts/lib/links.js"
[ ! -f "$LINKS_LIB" ] && { echo "ERROR: Could not locate scripts/lib/links.js. Is the Lift-SDLC plugin installed?" >&2; exit 2; }

# Parse arguments
INPUT_FILE=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --file) INPUT_FILE="$2"; shift ;;
        *) echo "Unknown parameter: $1" >&2; exit 2 ;;
    esac
    shift
done

if [ -n "$INPUT_FILE" ]; then
    node "$LINKS_LIB" --json --file "$INPUT_FILE"
else
    cat | node "$LINKS_LIB" --json
fi
LINK_EXIT=$?
