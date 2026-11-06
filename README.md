# Deer

> **Read gently. Understand deeply.**

**Deer** is a local-first AI reading companion for the desktop. It keeps your books on your own machine, lets you read them the way you like, and puts an AI companion beside the page when you want to go deeper.

**Languages:** English · [简体中文](README.zh-CN.md)

---

## About

**Deer** is named after a line from the Chinese classic *Lu Ming* (鹿鸣) in the *Book of Songs* — a call of welcome and friendly exchange. It sits beside you as you read: explaining hard passages, mapping ideas, answering questions, and drawing connections.

Deer doesn't read for you. It helps you read better, think further, and enjoy the journey.

## Features

### Library

- Import **EPUB, MOBI, AZW3, FB2, CBZ and PDF**; files are copied into the app's data directory, covers are extracted automatically
- Organize books on **shelves**, with four sort orders (recently read, title, author, date added)
- **Continue reading** card resumes the last book at the exact spot

### Reading

- **Table of contents** as a popover from the toolbar, plus chapter navigation
- **Paginated or scrolled** layout, with page-turn animation in three levels (off / fade / slide)
- Reading preferences: six font sizes, five line heights, three page margins, book or system fonts, paper colors, and a dark theme
- **Highlights and notes**: select text to highlight in several colors and styles, attach a note, and edit or recolor from the same popover
- **Notes page** collecting every highlight and note across the library
- **Footnote peek** for EPUB: hover a footnote marker to read the note in place
- Quick settings panel and full settings dialog (general, appearance, reading, AI, data, shortcuts, about)

### AI companion

- Docked chat panel on both the bookshelf and the reader — open it without sending anything, ask when you're ready
- **27 engines** through acpx: Claude Code, Codex, Kimi, Qwen, Gemini, Cursor and more, chosen in Settings; official acpx adapters install with one click, vendor CLIs are detected if already installed
- Chapter summaries, passage explanations, open-ended Q&A, and an idea map that shows how concepts connect
- The model can query your shelf through a built-in MCP server (`search_books`, `get_reading_state`, `get_library`) and return book cards you can open directly

## Requirements

- Node **22.13+** (the AI panel runs through acpx on Node)
- pnpm **12.3.4** (`packageManager` is pinned)
- Rust toolchain and the Tauri v2 system prerequisites for the desktop build
- `acpx@0.21.1` for AI features: `npm install -g acpx@0.21.1`
- At least one engine CLI of your choice (the Settings → AI list shows install status for each)

## Getting started

```bash
pnpm install
pnpm tauri dev     # the real desktop window
```

```bash
pnpm dev           # browser preview of the UI (native APIs unavailable)
pnpm test          # vitest
pnpm lint          # eslint
pnpm build         # type-check + production frontend build
```

Root scripts delegate to `apps/desktop`.

## Project structure

- `apps/desktop` — the Tauri + React application: bookshelf, reader, notes, settings, AI panel
- `apps/desktop/src-tauri` — Rust shell: acpx chat bridge, book MCP server, plugin registration and capabilities
- `apps/desktop/src/vendor/foliate-js` — vendored ebook engine used by the reader
- `docs/` — UX spec, design handoff (motion, tokens) and engineering notes

## Status

Early development. The app UI is currently Simplified Chinese only; macOS is the primary target. Books, annotations and settings are stored locally — nothing is uploaded except the prompts you send to the engine you selected.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](LICENSE) for the full text.