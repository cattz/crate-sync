# Design System: Crate Sync

## 1. Visual Theme & Atmosphere

Crate Sync is a dark-themed DJ tool that bridges Spotify, Lexicon DJ, and Soulseek. The interface draws inspiration from Spotify's dark immersive aesthetic but prioritizes **information density** over visual richness — this is a power-user dashboard for managing thousands of playlists and tracks, not a consumer music player.

The design is **utility-first darkness**: near-black backgrounds (`#0f0f0f`, `#1a1a1a`) with high-contrast text and color-coded status badges. The UI is dense, scannable, and built for keyboard-heavy workflows. Every pixel serves the sync/match/download pipeline.

**Key Characteristics:**
- Near-black background (`#0f0f0f`) with card surfaces at `#1a1a1a`
- Spotify Green (`#1db954`) as primary accent — always functional (sync, confirm, play)
- System font stack — no custom fonts, fast loading
- Compact 14px base — dense tables, small badges, minimal padding
- Fixed sidebar (180px) + scrollable content + fixed status bar at bottom
- Color-coded status system: green (confirmed/done), yellow (pending/warning), red (failed/danger), blue (downloading/info), gray (inactive)
- Monospace for IDs, file paths, timestamps, and logs

## 2. Color Palette & Roles

### CSS Custom Properties (source of truth: `globals.css`)

```css
--bg: #0f0f0f;           /* Deepest background */
--bg-card: #1a1a1a;      /* Cards, sidebar, status bar, modals */
--bg-hover: #252525;     /* Row hover, interactive hover */
--border: #2a2a2a;       /* All borders — cards, tables, inputs, sidebar */
--text: #e0e0e0;         /* Primary text */
--text-muted: #888;      /* Secondary text, labels, metadata */
--accent: #1db954;       /* Primary action — sync, confirm, play, links */
--accent-hover: #1ed760; /* Accent hover state */
--danger: #e74c3c;       /* Errors, delete, reject, failed */
--warning: #f39c12;      /* Pending review, wishlisted, caution */
--info: #3498db;         /* Downloading, in-progress, informational */
--radius: 8px;           /* Standard border radius */
```

### Status Badge Colors (semantic, semi-transparent backgrounds)

| Status | Background | Text | Usage |
|--------|-----------|------|-------|
| Green | `rgba(29,185,84,0.15)` | `#1db954` | In Lexicon, confirmed, done, synced |
| Yellow | `rgba(243,156,18,0.15)` | `#f39c12` | Pending review, wishlisted, validating |
| Red | `rgba(231,76,60,0.15)` | `#e74c3c` | Failed, not found, download error |
| Blue | `rgba(52,152,219,0.15)` | `#3498db` | Downloading, searching, tags |
| Gray | `rgba(136,136,136,0.15)` | `#888` | Inactive, origin labels, method badges |

### Review Similarity Colors (field comparison borders)

| Similarity | Color | CSS Variable |
|-----------|-------|-------------|
| High (≥ 0.8) | `var(--accent)` | Green — fields match |
| Medium (0.4–0.8) | `var(--warning)` | Orange — partial match |
| Low (< 0.4) | `var(--danger)` | Red — mismatch |

## 3. Typography Rules

### Font Families
- **UI/Body**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Mono**: `"SF Mono", "Fira Code", monospace` — file paths, IDs, logs, timestamps

### Hierarchy

| Role | Size | Weight | Color | Usage |
|------|------|--------|-------|-------|
| Page title | 1.15rem (h2) | 700 | `--text` | Page headers |
| Section title | 0.9rem (h3) | 600 | `--text` | Card headers, sections |
| Body | 14px (0.875rem) | 400 | `--text` | Default text |
| Secondary | 0.85rem | 400 | `--text-muted` | Subtitles, descriptions |
| Small | 0.8rem | 400/500 | `--text-muted` | Buttons, inputs, table headers |
| Badge | 0.7rem | 500 | status color | Status badges, tags |
| Micro | 0.7rem | 400 | `--text-muted` | Hints, helper text |
| Mono | 0.75rem | 400 | `--text-muted` | File paths, IDs, log lines |

### Table Headers
- `font-size: 0.8rem`, `font-weight: 500`
- `text-transform: uppercase`, `letter-spacing: 0.05em`
- Color: `--text-muted`

## 4. Component Stylings

### Buttons

**Default**
- Background: `--bg-card` (`#1a1a1a`)
- Border: `1px solid var(--border)`
- Text: `--text`, size `0.8rem`
- Padding: `0.3rem 0.7rem`
- Radius: `5px`
- Hover: `--bg-hover`

**Primary (`.primary`)**
- Background: `--accent` (`#1db954`)
- Border: `--accent`
- Text: `#000`, weight `600`
- Hover: `--accent-hover` (`#1ed760`)
- Usage: Match & Tag, Confirm, Save Settings

**Danger (`.danger`)**
- Background: transparent
- Border: `--danger`
- Text: `--danger`
- Hover: `rgba(231,76,60,0.1)` background
- Usage: Delete, Reject & Download

**Disabled**
- Opacity: `0.5`, cursor: `not-allowed`

### Cards (`.card`)
- Background: `--bg-card`
- Border: `1px solid var(--border)`
- Radius: `--radius` (8px)
- Padding: `0.75rem 1rem`
- Margin-bottom: `0.75rem`

### Badges (`.badge`)
- Padding: `0.1rem 0.4rem`
- Radius: `3px`
- Font: `0.7rem`, weight `500`
- Variants: `.badge-green`, `.badge-yellow`, `.badge-red`, `.badge-blue`, `.badge-gray`

### Stat Cards (`.stat-card`)
- Same as card but `display: flex`, `align-items: baseline`, `gap: 0.5rem`
- Label: `0.75rem`, uppercase, `--text-muted`
- Value: `1.25rem`, weight `700`

### Progress Bar (`.progress-bar`)
- Height: `6px`
- Track: `--border`
- Fill: `--accent`
- Radius: `3px`
- Animated width transition: `0.3s`

### Modals
- Overlay: `rgba(0,0,0,0.6)`, fixed, centered
- Card: min-width `340px`, max-width `460px`
- Same `.card` styling
- Click overlay to dismiss

### Inputs & Selects
- Background: `--bg`
- Border: `1px solid var(--border)`
- Text: `--text`, size `0.8rem`
- Padding: `0.3rem 0.6rem`
- Radius: `5px`
- Focus: `border-color: var(--accent)`, no outline

## 5. Layout Principles

### App Structure
```
┌──────────┬──────────────────────────────┐
│ Sidebar  │        Content Area          │
│ 180px    │   padding: 1.25rem 1.5rem    │
│ fixed    │   scrollable                 │
│          │                              │
│          │                              │
├──────────┴──────────────────────────────┤
│            Status Bar (fixed)            │
│   mono 0.7rem · job events · dl speed   │
└──────────────────────────────────────────┘
```

- **Sidebar**: 180px fixed, `--bg-card` background, bordered right
- **Content**: `margin-left: 180px`, `padding-bottom: 90px` (for status bar)
- **Status bar**: fixed bottom, mono font, real-time job events + download speed

### Sidebar Navigation
- Links: `0.85rem`, `--text-muted`, `padding: 0.35rem 1rem`
- Active/hover: `--bg-hover` background, `--text` color
- Sections: "SERVICES" label group at bottom with status dots

### Page Headers (`.page-header`)
- `display: flex`, `justify-content: space-between`, `align-items: center`
- Title left, action buttons right

### Tables
- `width: 100%`, `border-collapse: collapse`
- Use `table-layout: fixed` with `<colgroup>` for predictable column widths
- Cell padding: `0.35rem 0.6rem`
- Row separator: `border-bottom: 1px solid var(--border)`
- Row hover: `--bg-hover` background
- Long text: `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`
- Full text on hover via `title` attribute

### Spacing System
- Base: `0.25rem` increments
- Common: `0.35rem` (tight), `0.5rem` (small), `0.75rem` (medium), `1rem` (standard)
- Section gap: `0.75rem` (card margin-bottom)
- Page padding: `1.25rem 1.5rem`

### Bulk Toolbar (`.bulk-toolbar`)
- Fixed bottom center, floating above status bar (z-index 50)
- Card styling + `box-shadow: 0 4px 12px rgba(0,0,0,0.3)`
- Shows selection count + action buttons

## 6. Data Display Patterns

### Track Table (Playlist Detail)
Fixed columns: `#` (35px) | Title (30%) | Artist (25%) | Album (25%) | Duration (55px) | Status (90px)

### Review Comparison (Review Page)
Transposed table: columns = Title, Artist, Album, Duration. Rows = S (Spotify), L (Lexicon).
Left border per cell colored by per-field similarity (green/orange/red).

### Status Badges in Track Tables

| Status | Badge | Color |
|--------|-------|-------|
| In Lexicon | `badge-green` | Confirmed match |
| Downloading | `badge-blue` | Active download |
| Downloaded | `badge-gray` | File moved, not yet re-synced |
| Pending Review | `badge-yellow` | Needs human decision |
| Wishlisted | `badge-yellow` | Retry scheduled |
| Search Failed | `badge-red` | Not found on Soulseek |
| Download Failed | `badge-red` | Download/validation error |
| Not Matched | — (dash) | No match attempted |

### Spotify Play Button
- Green circle (`#1db954`), `border-radius: 50%`
- Black play triangle (`▶`)
- Sizes: 14px (table rows), 18px (headers)
- Opens `spotify:{type}:{id}` URI

## 7. Interaction Patterns

### Inline Feedback
- Success: green text below action area (e.g. "Push: 5 added, 2 removed")
- Error: red text below action area
- No toasts or alerts — results display inline

### Tag Editing
- Tags displayed as `.badge-blue` pills with `×` to remove
- Inline text input for adding
- Autocomplete dropdown from existing tags
- Bulk tag editor: solid badges = all selected have it, dashed/dimmed badges = partial

### Async Operations
- Button shows "Syncing..." / "Pushing..." while pending
- Badge appears: "Syncing..." (blue), "Synced ✓" (green), "Error" (red)
- Fades back to normal after 5 seconds
- Click badge to navigate to Logs page

### Multi-Select
- Checkbox column in tables
- Select-all checkbox with indeterminate state
- Floating bulk toolbar with action buttons
- Selection cleared after successful action

## 8. Do's and Don'ts

### Do
- Use `table-layout: fixed` with `<colgroup>` on ALL data tables
- Truncate long text with `text-overflow: ellipsis` + `title` for hover
- Show status as colored badges, not plain text
- Use `--text-muted` for secondary information (artists, metadata, timestamps)
- Keep buttons small (`0.3rem 0.7rem` padding) — this is a dense tool
- Use monospace for file paths, IDs, and log output
- Provide inline feedback for actions (no modals for success/error)
- Use `em dash` character (—) directly, never `\u2014` in JSX text

### Don't
- Don't change table column widths unless explicitly asked
- Don't use toasts or alert() — always inline feedback
- Don't add padding/spacing that reduces information density
- Don't use light backgrounds — maintain the near-black immersion
- Don't use Spotify Green decoratively — it's functional only (actions, links, play)
- Don't create per-row action buttons (View/Edit/Delete) — use click-to-navigate + bulk toolbar
- Don't use `\u2014` or other unicode escapes in JSX text content — use the actual character

## 9. Agent Prompt Guide

### Quick CSS Reference
```css
/* Card */       background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 0.75rem 1rem;
/* Button */     background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 5px; padding: 0.3rem 0.7rem; font-size: 0.8rem;
/* Primary */    background: #1db954; color: #000; font-weight: 600;
/* Badge */      padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.7rem;
/* Table */      table-layout: fixed; th: uppercase 0.8rem #888; td: 0.35rem 0.6rem;
/* Modal */      fixed overlay rgba(0,0,0,0.6); card min-width 340px;
```

### When Adding a New Page
1. Start with `<div className="page-header">` — title left, buttons right
2. Data in a `.card` with `<table style={{ tableLayout: "fixed" }}>` + `<colgroup>`
3. Status as `.badge` with appropriate color variant
4. Actions in header buttons, NOT per-row
5. Long text truncated with `overflow: hidden; text-overflow: ellipsis` + `title`
6. Inline feedback below action area for success/error

### When Adding a New Table
1. Always use `table-layout: fixed` with explicit `<colgroup>` widths
2. Use percentages for flexible columns, fixed px for narrow ones (checkbox, duration, status)
3. Add `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on content cells
4. Add `title` attribute with full text for hover
5. Sort headers with click handler + ▲/▼ indicator
