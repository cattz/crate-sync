---
# crate-sync-bg34
title: Investigate why slskd download webhook didn't trigger
status: completed
type: bug
priority: high
created_at: 2026-04-04T00:00:00Z
updated_at: 2026-04-08T00:00:00Z
---

## Description

The Glyders track downloaded successfully in slskd (file on disk at 21:31) but no webhook was received by crate-sync. The native webhook is configured in `slskd.yml` under `integration.webhooks.crate_sync`.

## Investigation findings

1. **Config is loaded correctly** — `SLSKD_APP_DIR=/app` in Docker, volume mounts `./data:/app`, so `slskd/data/slskd.yml` maps to `/app/slskd.yml`. User confirms other config from this file is active.

2. **Webhook handler code is correct** — verified against slskd source. slskd serializes `DownloadFileCompleteEvent` with `CamelCase` naming: `{ localFilename, remoteFilename, transfer: { username, filename, size, ... } }`. The handler already parses this format.

3. **`host.docker.internal` resolution** — most likely cause. On Linux, `host.docker.internal` doesn't resolve without `extra_hosts: ["host.docker.internal:host-gateway"]` in docker-compose. On macOS Docker Desktop it resolves automatically, but adding `extra_hosts` is a no-op there.

4. **slskd logs webhook failures** — `WebhookService.cs` logs warnings on failure with retry, but these may not have been checked.

## Fix

Added `extra_hosts: ["host.docker.internal:host-gateway"]` to `slskd/docker-compose.yaml`.

## Verification steps (manual)

1. Rebuild container: `docker compose -f slskd/docker-compose.yaml up -d --build`
2. Test manually: `curl -X POST http://localhost:3100/api/webhooks/slskd/download-complete -H "Content-Type: application/json" -d '{"transfer":{"username":"test","filename":"test.mp3"}}'`
3. Check slskd logs for webhook delivery: `docker logs slskd 2>&1 | grep -i webhook`
