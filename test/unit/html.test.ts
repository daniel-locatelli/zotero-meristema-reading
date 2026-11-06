import { describe, it } from "node:test";
import { expect } from "chai";

import {
  dataBlock,
  escapeHtml,
  extractDataBlock,
  unescapeHtml,
} from "../../src/format/html";
import { isItemKey, readVersionedBlock } from "../../src/format/common";

describe("HTML escaping", () => {
  it("round-trips text with markup characters", () => {
    const text = `a & <b> "c" 'd'`;
    expect(unescapeHtml(escapeHtml(text))).to.equal(text);
    expect(escapeHtml(text)).to.not.match(/[<>"]/);
  });

  it("decodes numeric entities and leaves unknown ones", () => {
    expect(unescapeHtml("&#39;&#x27;&nbsp;&foo;")).to.equal("'' &foo;");
  });
});

describe("extractDataBlock", () => {
  it("finds the block by its attribute among other blocks", () => {
    const html =
      '<pre>other</pre><pre class="x" data-thing="1">{&quot;a&quot;:1}</pre>';
    expect(extractDataBlock(html, "thing")).to.equal('{"a":1}');
  });

  it("strips tags the note editor may add inside the block", () => {
    const html = '<pre data-thing="1"><code>{"a":<br>1}</code></pre>';
    expect(extractDataBlock(html, "thing")).to.equal('{"a":\n1}');
  });

  it("returns null when no block carries the attribute", () => {
    expect(extractDataBlock('<pre data-other="1">{}</pre>', "thing")).to.equal(
      null,
    );
  });

  it("reads back what dataBlock wrote", () => {
    const json = '{"why":"a <b> & \\"c\\""}';
    expect(extractDataBlock(dataBlock("thing", json), "thing")).to.equal(json);
  });
});

describe("readVersionedBlock", () => {
  const block = (json: string) => dataBlock("thing", json);

  it("accepts version 1", () => {
    expect(
      readVersionedBlock(block('{"version":1,"x":2}'), "thing"),
    ).to.deep.equal({ ok: true, value: { version: 1, x: 2 } });
  });

  it("names each failure", () => {
    const reason = (html: string) => {
      const parsed = readVersionedBlock(html, "thing");
      return parsed.ok ? "ok" : parsed.reason;
    };
    expect(reason("<p>plain note</p>")).to.equal("no-data");
    expect(reason(block('{"version":1,'))).to.equal("bad-json");
    expect(reason(block('{"version":2}'))).to.equal("unknown-version");
    expect(reason(block("{}"))).to.equal("bad-shape");
    expect(reason(block("[1]"))).to.equal("bad-shape");
  });
});

describe("isItemKey", () => {
  it("accepts Zotero's eight-character keys only", () => {
    expect(isItemKey("ABCD2345")).to.equal(true);
    expect(isItemKey("ABCD2340")).to.equal(false); // 0 is not in the alphabet
    expect(isItemKey("abcd2345")).to.equal(false);
    expect(isItemKey("ABCD234")).to.equal(false);
    expect(isItemKey(12345678)).to.equal(false);
  });
});
