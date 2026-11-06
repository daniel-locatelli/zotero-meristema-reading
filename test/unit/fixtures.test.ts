import { describe, it } from "node:test";
import { expect } from "chai";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseReadingList,
  resolveReadingList,
  type FolderItem,
  type ResolvedStep,
} from "../../src/format/readingList";
import {
  emptyReadState,
  mergeReadStates,
  mirrorTag,
  nextUp,
  paperId,
  parseReadState,
  stateOf,
  type PaperRef,
  type ReadState,
  type ReadStateDoc,
} from "../../src/format/readState";

const root = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const text = (path: string): string => readFileSync(root + path, "utf8");
const json = <T>(path: string): T => JSON.parse(text(path)) as T;
const cases = (dir: string): string[] =>
  readdirSync(root + dir)
    .filter((name) => name.endsWith(".json"))
    .sort();

type Failure = { ok: false; reason: string };

interface ListCase {
  note: string;
  folder: FolderItem[];
  expect:
    | Failure
    | {
        ok: true;
        topic: string;
        steps: ResolvedStep[];
        unordered: string[];
      };
}

interface StateCase {
  notes: string[];
  expect:
    | Failure
    | {
        ok: true;
        states: Record<string, ReadState>;
        mirror: Record<string, string | null>;
      };
}

describe("list fixtures", () => {
  for (const name of cases("lists")) {
    it(name, () => {
      const c = json<ListCase>(`lists/${name}`);
      const want = c.expect;
      const parsed = parseReadingList(text(`lists/${c.note}`));
      if (!want.ok) {
        expect(parsed).to.deep.equal({ ok: false, reason: want.reason });
        return;
      }
      if (!parsed.ok) throw new Error(`${name} failed: ${parsed.reason}`);
      expect(parsed.value.topic).to.equal(want.topic);
      expect(resolveReadingList(parsed.value, c.folder)).to.deep.equal({
        steps: want.steps,
        unordered: want.unordered,
      });
    });
  }
});

describe("state fixtures", () => {
  for (const name of cases("states")) {
    it(name, () => {
      const c = json<StateCase>(`states/${name}`);
      const want = c.expect;
      let doc: ReadStateDoc = emptyReadState();
      for (const note of c.notes) {
        const parsed = parseReadState(text(`states/${note}`));
        if (!parsed.ok) {
          expect(want.ok, `${note} failed: ${parsed.reason}`).to.equal(false);
          if (!want.ok) expect(parsed.reason).to.equal(want.reason);
          return;
        }
        doc = mergeReadStates(doc, parsed.value);
      }
      if (!want.ok) throw new Error(`${name} parsed; wanted ${want.reason}`);
      for (const [id, state] of Object.entries(want.states)) {
        expect(stateOf(doc, id), id).to.equal(state);
      }
      for (const [id, tag] of Object.entries(want.mirror)) {
        expect(mirrorTag(stateOf(doc, id)), id).to.equal(tag);
      }
    });
  }
});

describe("paper-id fixtures", () => {
  for (const c of json<{ ref: PaperRef; id: string }[]>("paper-ids.json")) {
    it(c.id, () => {
      expect(paperId(c.ref)).to.equal(c.id);
    });
  }
});

describe("next-up fixtures", () => {
  const all = json<
    {
      steps: string[];
      states: Record<string, ReadState>;
      expect: string | null;
    }[]
  >("next-up.json");
  all.forEach((c, index) => {
    it(`case ${index + 1}`, () => {
      const steps = c.steps.map((key) => ({ key }));
      expect(nextUp(steps, (key) => c.states[key] ?? "unread")).to.equal(
        c.expect,
      );
    });
  });
});
