# Meristema Reading

Ordered reading lists for Zotero, with read state kept per paper. Design:
`meristema-zotero/docs/superpowers/specs/2026-11-06-reading-lists-design.md`.

## The plugin

Meristema Reading is a Zotero 9 and 10 plugin built from this repo.

- **Mark as** (item menu): Unread, Reading or Read, for one paper or a
  selection. The state lives in one note in My Library, tagged
  `meristema-reading-state`. It is mirrored onto `_unread`, `_reading` and
  `_read` tags in My Library for Zotero apps without plugins. A paper gets
  `_unread` only while it sits in a My Library folder that holds a reading
  list; an Unread paper in no list gets no tag. The mirror is one way: a tag
  changed by hand is put back.
- **Make Reading List** (folder menu): a note tagged `meristema-reading-list`
  holding the folder's papers in the order the item list shows them.
- **Step** (column picker): a paper's step in the selected folder's list.
  Sorting by it gives the reading order.
- **Reading list** (item pane, for a paper in a list folder): the steps in
  order, next up outlined. Drag a step's handle, or press Alt+Up and Alt+Down,
  to reorder it. Drop a paper from "Not in the steps" onto a step to add it,
  and drop a step there to take it out. Click a state to move it through
  Unread, Reading and Read, and type a reason under a step.
- **Open Reading List** (folder menu, or Open as Tab in the section): the same
  list as full-width cards, reasons in full. List tabs open when Zotero quits
  come back when it starts.

`npm start` runs it in a dev Zotero (copy `.env.example` to `.env` first),
`npm test` runs the Zotero suite, and `npm run check` runs prettier, eslint,
the type checks and the unit tests.

`src/format/` holds the two note formats; `fixtures/` holds the sample notes
every implementation of them must read alike (see `fixtures/README.md`).

    npm install
    npm run check
