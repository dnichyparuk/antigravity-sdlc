#!/usr/bin/env bash
node -e "
  const pattern = new RegExp(process.argv[1]);
  const subject = process.argv[2];
  if (!pattern.test(subject)) { process.exit(1); }
" "$1" "$2"
