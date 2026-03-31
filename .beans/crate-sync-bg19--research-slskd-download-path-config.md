---
# crate-sync-bg19
title: Research slskd config to control download path structure
status: done
type: task
priority: normal
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T00:00:00Z
---

## Description

The current file lookup after slskd downloads is fragile because slskd's folder structure is unpredictable. Research slskd's configuration options to see if we can control how downloaded files are organized on disk.

## Questions to answer

- Can slskd be configured to use a flat download directory (no subdirectories)?
- Can we control the naming pattern for downloaded files?
- Is there a way to set a per-download destination path via the API?
- Does the `directories.downloads` config in slskd.yml control this?
- Can we use slskd's post-download scripts/webhooks to move files to a known location?

## Findings

### 1. Can slskd be configured to use a flat download directory (no subdirectories)?

**No.** slskd mirrors the Soulseek convention: a file at `@@share\foo\bar\baz.mp3` on the remote user's machine is saved as `<downloads>/bar/baz.mp3` (parent directory + filename). There is no configuration option to flatten this into a single directory. This is confirmed by [GitHub issue #1584](https://github.com/slskd/slskd/issues/1584), which is an open feature request to add control over how downloaded files are placed on disk.

### 2. Can we control the naming pattern for downloaded files?

**No.** slskd preserves the original filename from the remote user. When a collision would occur, it appends a unique numeric suffix (e.g., `track_639091878895823617.mp3`). There is no config for custom naming templates.

### 3. Is there a way to set a per-download destination path via the API?

**No.** The `POST /api/v0/transfers/downloads/{username}` endpoint accepts an array of `{ filename, size }` objects -- nothing else. There is no `destination`, `path`, or `outputDir` parameter. Our `soulseek-service.ts` correctly reflects the full API surface:

```ts
// soulseek-service.ts:226-229
await this.request(
  "POST",
  `/transfers/downloads/${encodeURIComponent(username)}`,
  [item],  // item = { filename, size? }
);
```

The slskd-python-api client (`slskd-api` on PyPI) also shows no destination parameter.

### 4. Does `directories.downloads` in slskd.yml control this?

**Partially.** The `directories.downloads` config (or `SLSKD_DOWNLOADS_DIR` env var) sets the **root** directory where completed downloads land. The `directories.incomplete` sets where in-progress files go. Both default to `APP_DIR/downloads` and `APP_DIR/incomplete` respectively. However, within the downloads root, slskd still creates subdirectories mirroring the remote path structure. So this setting controls the root but not the internal layout.

From `slskd.yml`:
```yaml
# directories:
#   incomplete: ~
#   downloads: ~
```

In `docker-compose.yaml`, the single volume mapping `./data:/app` means the downloads land at `/app/downloads/` inside the container, which is `slskd/data/downloads/` on the host.

### 5. Can we use slskd's post-download scripts/webhooks to move files to a known location?

**Yes -- this is the most viable approach.** slskd supports both scripts and webhooks triggered on download events. The relevant events are:

- `DownloadFileComplete` -- fires when a single file finishes downloading
- `DownloadDirectoryComplete` -- fires when all files in a directory finish

The event data is passed as JSON in the `$SLSKD_SCRIPT_DATA` environment variable. A script can parse this to get the filename and local path, then move/rename the file to a predictable location.

Example from `slskd.yml`:
```yaml
# integration:
#   scripts:
#     move_downloads:
#       on:
#         - DownloadFileComplete
#       run:
#         executable: /bin/sh
#         arglist:
#           - -c
#           - echo $SLSKD_SCRIPT_DATA >> linux_sh_and_args_list.txt
```

**Security note:** `$SLSKD_SCRIPT_DATA` comes from the Soulseek network and may contain malicious content. Avoid passing it as shell arguments; read it from the env var and parse the JSON safely.

Webhooks are also an option -- they POST to a URL with headers/auth and have retry/timeout support.

### Our current workaround

Our `download-service.ts` already handles the unpredictable path structure with a two-strategy file lookup in `findDownloadedFile()`:

1. **Strategy 1:** Try the expected `last-2-segments` path (e.g., `<downloadDir>/bar/baz.mp3`), then check for suffixed variants in that directory.
2. **Strategy 2:** Recursively search all subdirectories of `slskdDownloadDir` for a matching filename.

This works but is fragile and slow for large download directories.

### Recommendations

1. **Short term:** Keep the current `findDownloadedFile()` approach -- it works.
2. **Medium term:** Add a `DownloadFileComplete` **script** in `slskd.yml` that moves files to a flat, predictable directory (e.g., `<downloadDir>/_flat/<username>__<filename>`). This eliminates the need for recursive search.
3. **Alternative:** Use a **webhook** to notify crate-sync directly when a download completes, passing the local path. This would let us skip polling in `waitForDownload()` entirely.
4. **Watch** [slskd issue #1584](https://github.com/slskd/slskd/issues/1584) for native per-download path control.

## References

- slskd config template: `slskd/data/slskd.yml`
- slskd docs: https://github.com/slskd/slskd
- slskd issue #1584: https://github.com/slskd/slskd/issues/1584
- slskd-python-api docs: https://slskd-api.readthedocs.io/
- Current download dir config: `soulseek.downloadDir` in crate-sync config
- File lookup logic: `src/services/download-service.ts` lines 686-750
