# Crate Sync

CLI tool to manage Spotify playlists and sync them with Lexicon DJ. Downloads missing tracks from Soulseek.

## Prerequisites

- Node.js 20+
- [slskd](https://github.com/slskd/slskd) running locally (for Soulseek downloads)
- [Lexicon DJ](https://www.lexicondj.com/) with REST API enabled
- Spotify Developer App credentials

## Setup

```bash
pnpm install
```

### Configuration

Create `~/.config/crate-sync/config.json`:

```json
{
  "spotify": {
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret"
  },
  "lexicon": {
    "url": "http://localhost:48624",
    "downloadRoot": "/path/to/music/downloads"
  },
  "soulseek": {
    "slskdUrl": "http://localhost:5030",
    "slskdApiKey": "your-api-key"
  }
}
```

### Spotify Developer App

1. Create an app at https://developer.spotify.com/dashboard
2. Add `http://127.0.0.1:8888/callback` as a Redirect URI in the app settings
3. Copy the Client ID and Client Secret into your config

### Authenticate with Spotify

```bash
pnpm dev auth login
```

## Usage

```bash
# Check service connectivity
pnpm dev status

# Sync Spotify playlists to local database
pnpm dev db sync

# List playlists
pnpm dev playlists list

# Show playlist details
pnpm dev playlists show <id>

# Find duplicates
pnpm dev playlists dupes [playlist-id]

# Match a playlist against Lexicon library
pnpm dev lexicon match <playlist-id>

# Search Soulseek
pnpm dev download search "artist - title"

# Full sync pipeline (match → review → download → Lexicon)
pnpm dev sync <playlist-id>
pnpm dev sync --all
pnpm dev sync <playlist-id> --dry-run

# Spotify URLs work anywhere a playlist ID is accepted
pnpm dev sync https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M

# Manage match registry
pnpm dev matches list
pnpm dev matches confirm <id>
pnpm dev matches reject <id>

# Database status
pnpm dev db status
```

## Debugging

Pass `--debug` to write detailed logs to `./data/crate-sync.log`:

```bash
pnpm dev --debug sync <playlist-id>
```

The log includes Soulseek search queries, filter/ranking steps, and candidate scores — useful for diagnosing why a track download failed.

## Development

```bash
pnpm test          # Run tests
pnpm lint          # Type-check
pnpm build         # Build for distribution
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design decisions and [FEATURES.md](./FEATURES.md) for the full feature set.
