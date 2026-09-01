#!/usr/bin/env bash

# Central wrapper to execute skill scripts
[ -z "$1" ] && { echo "ERROR: No script path provided to run.sh." >&2; exit 2; }
[ ! -f "$SDLC_ROOT/$1" ] && { echo "ERROR: Script not found: $1" >&2; exit 2; }

source "$SDLC_ROOT/$1" "$SDLC_ROOT"
