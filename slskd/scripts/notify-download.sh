#!/bin/sh
# Notify crate-sync when slskd completes a download.
# slskd sets $SLSKD_SCRIPT_DATA with JSON containing download info.
# This script is configured as the DownloadFileComplete handler in slskd.yml.
curl -s -X POST "http://host.docker.internal:3100/api/webhooks/slskd/download-complete" \
  -H "Content-Type: application/json" \
  -d "$SLSKD_SCRIPT_DATA" || true
