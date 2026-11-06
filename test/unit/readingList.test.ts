import { describe, it } from "node:test";
import { expect } from "chai";

import {
  itemHref,
  parseReadingList,
  resolveReadingList,
  writeReadingList,
  type ReadingListDoc,
} from "../../src/format/readingList";
import { dataBlock } from "../../src/format/html";

const doc: ReadingListDoc = {
  version: 1,
  topic: "Joints & <glue>",
  steps: [
    { key: "ABCD2345", why: 'Start "here" & <now>' },
    { key: "BCDE3456", why: "" },
  ],
};

const note = (json: string) => dataBlock("meristema-reading-list", json);

describe("writeReadingList", () => {
  it("reads back as the same document", () => {
    const html = writeReadingList(doc, (key) => `Paper ${key}`, {
      kind: "user",
    });
    expect(parseReadingList(html)).to.deep.equal({ ok: true, value: doc });
  });

  it("links each step to its paper and gives its reason", () => {
    const html = writeReadingList(doc, (key) => `Paper ${key}`, {
      kind: "group",
      id: 123,
    });
    expect(html).to.contain(
      "<h1>Reading list - Joints &amp; &lt;glue&gt;</h1>",
    );
    expect(html).to.contain(
      '<li><a href="zotero://select/groups/123/items/ABCD2345">Paper ABCD2345</a>: Start &quot;here&quot; &amp; &lt;now&gt;</li>',
    );
    expect(html).to.contain(
      '<li><a href="zotero://select/groups/123/items/BCDE3456">Paper BCDE3456</a></li>',
    );
  });
});

describe("itemHref", () => {
  it("addresses the user's library and a group's", () => {
    expect(itemHref({ kind: "user" }, "ABCD2345")).to.equal(
      "zotero://select/library/items/ABCD2345",
    );
    expect(itemHref({ kind: "group", id: 7 }, "ABCD2345")).to.equal(
      "zotero://select/groups/7/items/ABCD2345",
    );
  });
});

describe("parseReadingList", () => {
  it("reads a missing reason as empty", () => {
    const parsed = parseReadingList(
      note('{"version":1,"topic":"T","steps":[{"key":"ABCD2345"}]}'),
    );
    expect(parsed).to.deep.equal({
      ok: true,
      value: { version: 1, topic: "T", steps: [{ key: "ABCD2345", why: "" }] },
    });
  });

  it("refuses a reason that is not text, or a key that is not a key", () => {
    for (const json of [
      '{"version":1,"topic":"T","steps":[{"key":"ABCD2345","why":3}]}',
      '{"version":1,"topic":"T","steps":[{"key":"abc","why":"x"}]}',
      '{"version":1,"topic":"T","steps":{}}',
      '{"version":1,"steps":[]}',
    ]) {
      expect(parseReadingList(note(json)), json).to.deep.equal({
        ok: false,
        reason: "bad-shape",
      });
    }
  });
});

describe("resolveReadingList", () => {
  it("drops steps outside the folder, renumbers, and sorts the leftovers", () => {
    const resolved = resolveReadingList(
      {
        version: 1,
        topic: "T",
        steps: [
          { key: "ABCD2345", why: "a" },
          { key: "BCDE3456", why: "b" },
          { key: "CDEF4567", why: "c" },
        ],
      },
      [
        { key: "CDEF4567", title: "Third" },
        { key: "DEFG5678", title: "beta" },
        { key: "ABCD2345", title: "First" },
        { key: "EFGH6789", title: "Alpha" },
      ],
    );
    expect(resolved).to.deep.equal({
      steps: [
        { step: 1, key: "ABCD2345", why: "a" },
        { step: 2, key: "CDEF4567", why: "c" },
      ],
      unordered: ["EFGH6789", "DEFG5678"],
    });
  });
});
