#!/bin/bash
# Wrapper to truncate verbose output for LLM context limits

if [ -z "$1" ]; then
    echo "Usage: $0 <command>"
    exit 1
fi

COMMAND="$1"
MAX_HEAD=100
MAX_TAIL=400
TOTAL_MAX=$((MAX_HEAD + MAX_TAIL))

# Run the command and capture all output
OUTPUT=$(eval "$COMMAND" 2>&1)
EXIT_CODE=$?
LINES=$(echo "$OUTPUT" | wc -l)

if [ "$LINES" -gt "$TOTAL_MAX" ]; then
    echo "$OUTPUT" | head -n "$MAX_HEAD"
    echo ""
    echo "...[TRUNCATED_LOGS: $((LINES - TOTAL_MAX)) lines removed]..."
    echo ""
    echo "$OUTPUT" | tail -n "$MAX_TAIL"
else
    echo "$OUTPUT"
fi

exit $EXIT_CODE
