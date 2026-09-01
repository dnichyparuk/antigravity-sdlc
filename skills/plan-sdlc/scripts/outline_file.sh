#!/bin/bash
# Codebase exploration tool to extract structural outlines without bloating context window.

if [ -z "$1" ]; then
    echo "Usage: $0 <file_path>"
    exit 1
fi

FILE_PATH="$1"

if [ ! -f "$FILE_PATH" ]; then
    echo "Error: File not found - $FILE_PATH"
    exit 1
fi

echo "--- OUTLINE FOR $FILE_PATH ---"
grep -nE '^[[:space:]]*(export|import|class|def|function|struct|interface|type|enum|const|let|var)[[:space:]]+' "$FILE_PATH" | head -n 300
