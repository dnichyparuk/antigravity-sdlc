#!/usr/bin/env bash

if [ -z "$1" ]; then
  echo "Usage: $0 <file-path>" >&2
  exit 1
fi

node -e "
const fs = require('fs');
const path = require('path');
const { validateDimensionFile } = require(path.join(__dirname, '../../../scripts/lib/dimensions.js'));

const target = process.argv[1];
if (!fs.existsSync(target)) {
  console.error('File not found: ' + target);
  process.exit(1);
}

const { errors, warnings } = validateDimensionFile(target);

if (warnings && warnings.length > 0) {
  warnings.forEach(w => console.log('Warning (' + w.check + '): ' + w.message + (w.line ? ' at line ' + w.line : '')));
}

if (errors && errors.length > 0) {
  errors.forEach(e => console.error('Error (' + e.check + '): ' + e.message + (e.line ? ' at line ' + e.line : '')));
  process.exit(2);
}

console.log('Dimension file is valid.');
" "$1"
