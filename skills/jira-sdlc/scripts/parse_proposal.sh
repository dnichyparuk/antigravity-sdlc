#!/usr/bin/env bash
[ -z "$1" ] && { echo "ERROR: Missing field" >&2; exit 2; }
node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).proposal['$1'] || '')))"
