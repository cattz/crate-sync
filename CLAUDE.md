# Crate Sync

This project is intended to build a helper tool to manage my Spotify playlists (maybe Tidal as well) adn sync them with Lexicon.
This is basically a mix of 2 separate projects that I started:

- `sldl-python` is a tool that, given a spotify playlist, syncs that list songs with a playlist with the same name in LexiconDJ. For the songs that can not find in Lexicon, it tries to download them form different sources. Currently only Soulseek is implemented.

- `spoty-poty` is a tool that helps me manage my Spotify playlists: rename, merge, fix, remove duplicates, etc.

- `slsk-batchdl` is a tool I took as a starting poitn for `sldl-python`. I's kept for reference.

Some design notes:

- I want the Spotify data to persist locally (probably Sqlite) so we do not get into throttling issues with Spotify.

- Song matching is very important and we use it in several places. It should be pluggable and easier to maintain.
    - Spotify -> LexiconDJ
    - Spotify -> soulseek
    - Soulseek download -> Spotify -> Lexicon
    - Spotify -> spotify for matching lists with duplicates
    - ...

- Since manual intervention to confirm/deny matches will be unavoidable, I want to keep a *central* location to list all the known false matches.

I want to complete the list of features and high level architecture design and choice of stack before starting any implementation.

## Design System

When building or modifying any UI components, always follow the rules in `design-rules/DESIGN.md`. Key rules:
- Use `table-layout: fixed` with `<colgroup>` on ALL data tables
- Never use `\u2014` in JSX text — use the actual `—` character
- Don't change table column widths unless explicitly asked
- Inline feedback, no toasts/alerts
- No per-row action buttons — use click-to-navigate + bulk toolbar

## Testing — CRITICAL

**Always write tests for destructive operations before shipping.** Any code that deletes, removes, or modifies data on Spotify, Lexicon, or the local DB MUST have tests covering:
- Happy path
- Edge cases (empty data, all-local tracks, null fields)
- Safety checks (confirmation prompts, refusal to empty playlists)
- The exact scenario that would cause data loss

Push to Spotify has already destroyed playlists. Never again. Run `npx vitest run` before committing.

## Workflow

- Use Claude Code native tasks to track work items organically during conversations.
- Commit changes for each bean (work package) separately before moving on to the next one.