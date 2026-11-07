# Meristema Reading

Ordered reading lists for Zotero, with read state kept per paper. Design:
`meristema-zotero/docs/superpowers/specs/2026-11-06-reading-lists-design.md`.

## The plugin

Meristema Reading is a Zotero 9 and 10 plugin built from this repo.

- **Mark as** (item menu): Unread, Reading or Read, for one paper or a
  selection. The state lives in one note in My Library, tagged
  `meristema-reading-state`. It is mirrored onto `_reading` and `_read` tags in
  My Library for Zotero apps without plugins. The mirror is one way: a tag
  changed by hand is put back.
- **Make Reading List** (folder menu): a note tagged `meristema-reading-list`
  holding the folder's papers in the order the item list shows them.
- **Step** (column picker): a paper's step in the selected folder's list.
  Sorting by it gives the reading order.

`npm start` runs it in a dev Zotero (copy `.env.example` to `.env` first),
`npm test` runs the Zotero suite, and `npm run check` runs prettier, eslint,
the type checks and the unit tests.

`src/format/` holds the two note formats; `fixtures/` holds the sample notes
every implementation of them must read alike (see `fixtures/README.md`).

    npm install
    npm run check
