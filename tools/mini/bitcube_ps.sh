#!/bin/bash
# Run a PowerShell script on bitcube from the Mac mini, reading the script from stdin.
#   tools/mini/bitcube_ps.sh <<'PS'
#   Get-NetIPConfiguration
#   PS
# The script goes over as -EncodedCommand (UTF-16LE base64), so nothing is mangled by cmd.exe quoting.
# Progress output is silenced and blank lines dropped. Uses the `bitcube` SSH alias (key auth).
enc=$( { echo "\$ProgressPreference = 'SilentlyContinue'"; cat; } | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh -o ConnectTimeout=15 -o BatchMode=yes bitcube "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $enc" 2>&1 | tr -d '\r' | grep -v '^\s*$'
