// Copied verbatim from meristema-zotero `src/domain/workIdentity.ts`; keep the
// two in step, since a paper id is built from it.
export function normalizeDOI(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLocaleLowerCase();
  const match = text.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
  return match ? match[0].replace(/[.,;]+$/, "").toLocaleLowerCase() : null;
}
