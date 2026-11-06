# Format fixtures

Every implementation of the two note formats (this plugin, Meristema, the
using-zotero skill) must pass every case here. Change a case only together with
the spec. This file and the fixtures are the whole contract: a port should not
need to read the TypeScript.

## Layout

`index.json` names every case file:
`{ "lists": [file], "states": [file], "writes": [file], "paperIds": file, "nextUp": file }`,
the first three relative to their directory. A runner must run exactly those
cases, fail when a directory holds a `.json` the index does not name (or the
index names one that is missing), and fail when any `.html` under `fixtures/`
is not the note of some case.

The `.html` files are byte-exact (prettier skips them), some written as the
Zotero note editor may leave them. Read them as UTF-8.

## Case files

- `lists/<case>.json`: `{ "note": "<file>.html", "folder": [{ "key", "title" }], "expect": … }`.
  `expect` is `{ "ok": false, "reason" }`, or
  `{ "ok": true, "topic", "steps": [{ "step", "key", "why" }], "unordered": [key] }`,
  the result of parsing the note and resolving it against `folder`.
- `states/<case>.json`: `{ "notes": ["<file>.html", …], "expect": … }`.
  - `{ "ok": false, "reason" }`: the case has one note, and parsing it fails
    with that reason.
  - `{ "ok": true, "states": { id: { "state", "at" } }, "absent": [id], "mirror": { id: tag | null } }`:
    parse each note and merge them, starting from an empty state. Merge in
    either order: the runner merges the notes as listed and again reversed,
    and both must give this result. `states` is the full map of stored
    entries, compared whole. Each `absent` id has no entry and reads as
    Unread. `mirror` is the tag for each id's state.
- `writes/<case>.json`: the writers' input, and `note`, a file holding the
  exact note the writer returns (no trailing newline).
  - `{ "kind": "list", "doc": { "version", "topic", "steps" }, "labels": { key: label }, "library", "note" }`.
  - `{ "kind": "state", "doc": { "version", "states" }, "note" }`.
    The runner also parses the written note back and expects `doc`.
- `paper-ids.json`: `[{ "ref": { "doi", "library", "key" }, "id" }]`, where
  `library` is `{ "kind": "user" }` or `{ "kind": "group", "id" }`. Each `id`
  is also a valid paper id.
- `next-up.json`: `[{ "steps": [key], "states": { key: state }, "expect": key | null }]`;
  a key missing from `states` is Unread, and so is an explicit `"unread"`.

## Finding the data block

The list block's attribute is `meristema-reading-list`, the state block's
`meristema-reading-state`. With the attribute in place of `ATTR`, the block is
the first match in the note of this regex, case-insensitive throughout (tag,
attribute name and `</pre>`):

```
<pre\b[^>]*\bdata-ATTR\s*=\s*["']?1["']?[^>]*>([\s\S]*?)</pre>
```

Copy its leniency as it is: the value may be quoted with `"` or `'` or not at
all (and the quotes need not match); the name may sit inside a longer one such
as `x-data-ATTR`; the value only has to start with `1`, so `10` matches too;
the block ends at the first `</pre>`. A `<pre>` that does not match is
skipped, so the first matching one wins over any later one.

The captured text then goes through three steps, in order:

1. Every `<br>`, `<br/>`, `<br />` (regex `<br\s*\/?>`, any case) becomes
   `\n`. A `<br>` inside a JSON string is then a raw newline, which is
   `bad-json`.
2. Every other tag (regex `<[^>]*>`) is removed.
3. Entities are decoded, in one pass (`&amp;lt;` becomes `&lt;`). Only these
   forms are decoded, and only with the closing semicolon:
   - `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` `&nbsp;`, name in any case
     (`&AMP;` too), as `&` `<` `>` `"` `'` and a plain space U+0020;
   - `&#` decimal digits `;` and `&#x` (or `&#X`) hex digits `;`, as that
     code point when it is at most `0x10FFFF`.

   Anything else stays literal: other named entities such as `&eacute;`,
   `&#65` without its semicolon, numbers above `0x10FFFF`.

`\d` and `\s` here and below are JavaScript's: `\d` is ASCII `0-9` only.

## Parse failures

In this order:

1. No matching block: `no-data`.
2. The text is not JSON (`JSON.parse` rules: no `NaN` or `Infinity`): `bad-json`.
3. The top level is not an object (an array, a string, `null`): `bad-shape`.
4. `version` is the number 1 (`1.0` is the number 1): go on. Another number:
   `unknown-version`. Anything else, including missing, `true` and `"1"`:
   `bad-shape`.
5. The format's own checks, below; all of them fail with `bad-shape`.

Keys a format does not name are ignored, and the writers drop them.

## Reading list

- `topic` must be a string and `steps` an array.
- Each step must be an object whose `key` is an item key. A missing `why` is
  `""`; any other non-string `why`, `null` included, fails. One bad step fails
  the whole list.
- A key that comes again keeps its first place; the later step is dropped
  (after it has passed the checks above).
- Resolving against a folder: the steps whose key is in the folder, in list
  order, numbered from 1. `unordered` is every folder item not among them,
  sorted by title lowercased (Unicode lowercase, no locale), then by key, both
  compared by UTF-16 code unit (not code point, not collation).

## Read state

- `states` must be an object. Unlike list steps, each entry is checked on its
  own and dropped when bad: the id is not a paper id, the entry is not an
  object, `state` is not `unread`, `reading` or `read`, or `at` is not valid.
- `at` is valid when it matches
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$`
  (checked first) and then names a real instant. No zone, a date alone,
  `"1"` or `"Nov 1 2026"` are not valid. Setting a state with an invalid `at`
  or an id that is not a paper id is refused.
- A paper with no entry is Unread. Setting Unread stores an entry (a
  tombstone), so it can win a merge.
- Merging two documents keeps every id from either. For an id in both, the
  winner is decided by the first rule that separates them:
  1. a valid `at` beats an invalid one;
  2. the later instant;
  3. read over reading over unread;
  4. the greater `at` string, by code unit (`…00Z` over `…00.000Z`).
- Mirror tags: `_reading` for Reading, `_read` for Read, none for Unread. The
  format layer does not decide that group items get no mirror tags; the store
  does, and no fixture here covers it.

## Ids

- Item key: exactly eight characters from `23456789ABCDEFGHIJKLMNPQRSTUVWXYZ`.
- Paper id: `doi:` followed by a DOI equal to its own normalisation (so no
  capitals, no trailing `.`), or `user:` and an item key, or `group-`, ASCII
  digits, `:` and an item key.
- `paperId(ref)` is `doi:` and `normalizeDOI(ref.doi)` when that is not null;
  else `user:KEY` for the user library, `group-ID:KEY` for a group.
- `normalizeDOI(value)`:
  1. `null` or missing is `""`; anything else becomes its string form.
  2. Trim whitespace (JavaScript `trim`: Unicode White_Space and U+FEFF, not
     U+001C to U+001F as Python's `strip` would); drop a leading `http://` or `https://`, optional `dx.`,
     `doi.org/` (any case); drop a leading `doi:` and the whitespace after it
     (any case); trim again; lowercase.
  3. Find the first `10\.\d{4,9}/[-._;()/:a-z0-9]+` (any case). None: null.
  4. Drop trailing `.`, `,` and `;` from it, and lowercase it.

## Writers

Both notes are one line, no trailing newline. `E(text)` replaces `&` with
`&amp;` (first), `<` with `&lt;`, `>` with `&gt;` and `"` with `&quot;`, and
leaves everything else, `'` and control characters included, as it is.

A list note is `<h1>Reading list - E(topic)</h1><ol>`, then per step
`<li><a href="HREF">E(label)</a>: E(why)</li>` (without `: E(why)` when `why`
is empty), then `</ol><p>Plugin data (do not edit)</p>`, then
`<pre data-meristema-reading-list="1">E(JSON)</pre>`. `HREF` is
`zotero://select/library/items/KEY` for the user library and
`zotero://select/groups/ID/items/KEY` for a group. `label` is given by the
caller (the cases give it in `labels`).

A state note is `<h1>Reading state</h1><p>R reading, D read. Kept by Meristema Reading.</p><p>Plugin data (do not edit)</p>`,
with R and D the counts of Reading and Read entries, then
`<pre data-meristema-reading-state="1">E(JSON)</pre>`.

`JSON` is what `JSON.stringify` writes, which Python's
`json.dumps(value, ensure_ascii=False, separators=(",", ":"))` matches:

- no whitespace between tokens; `version` written as `1`;
- keys in this order: list `version`, `topic`, `steps`, each step `key`,
  `why` (always present, `""` when empty); state `version`, `states`, ids
  sorted by code unit, each entry `state`, `at` (as stored, unchanged);
- in strings, `"` and `\` are escaped with a backslash; U+0008, U+0009,
  U+000A, U+000C and U+000D as `\b`, `\t`, `\n`, `\f`, `\r`; other characters
  below U+0020 as `\u00xx` with lowercase hex; everything else is written as
  itself (non-ASCII, `/`, U+007F, U+2028 and U+2029 included).
