#!/usr/bin/env bash
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <file-path>" >&2
  exit 1
fi

if [ ! -f "$1" ]; then
  echo "Error: File '$1' not found" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const crypto = require("crypto");
try {
  const content = fs.readFileSync(process.argv[1]);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  console.log(hash);
} catch (err) {
  console.error("Error hashing file:", err.message);
  process.exit(2);
}
' "$1"
