# Format fixtures

Every implementation of the two note formats (this plugin, Meristema, the
using-zotero skill) must pass every case here. Change a case only together with
the spec.

- `lists/<case>.json`: `{ "note": "<file>.html", "folder": [{ "key", "title" }], "expect": … }`.
  `expect` is `{ "ok": false, "reason" }`, or
  `{ "ok": true, "topic", "steps": [{ "step", "key", "why" }], "unordered": [key] }`,
  the result of parsing the note and resolving it against `folder`.
- `states/<case>.json`: `{ "notes": ["<file>.html", …], "expect": … }`. Parse
  each note and merge them in order, starting from an empty state. `expect` is
  `{ "ok": false, "reason" }` (the first note fails with it), or
  `{ "ok": true, "states": { id: state }, "mirror": { id: tag | null } }`.
- `paper-ids.json`: `[{ "ref": { "doi", "library", "key" }, "id" }]`, where
  `library` is `{ "kind": "user" }` or `{ "kind": "group", "id" }`.
- `next-up.json`: `[{ "steps": [key], "states": { key: state }, "expect": key | null }]`;
  a key missing from `states` is Unread.

The `.html` files are byte-exact (prettier skips them), some written as the
Zotero note editor may leave them.
