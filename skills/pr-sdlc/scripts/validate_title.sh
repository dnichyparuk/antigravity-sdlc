#!/usr/bin/env bash
node -e "
const title = process.argv[1];
const pattern = process.argv[2];
const error = process.argv[3];
if (!new RegExp(pattern).test(title)) {
  console.error(error || pattern);
  process.exit(1);
}
" "$1" "$2" "$3"
