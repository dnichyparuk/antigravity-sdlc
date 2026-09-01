#!/usr/bin/env bash
[ -z "$1" ] && { echo "ERROR: No MANIFEST_FILE provided." >&2; exit 2; }

node -e "
const fs = require('node:fs');
try {
  const manifestFile = process.argv[1];
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const diffDir = manifest.diff_dir;
    
    // Safety check: ensure we only delete temporary review directories
    if (diffDir && diffDir.includes('sdlc-review-') && fs.existsSync(diffDir)) {
      fs.rmSync(diffDir, { recursive: true, force: true });
    }
    
    // Clean up the manifest itself
    fs.unlinkSync(manifestFile);
  }
} catch (e) {
  process.stderr.write('Warning: Cleanup failed - ' + e.message + '\n');
}
" "$1"
