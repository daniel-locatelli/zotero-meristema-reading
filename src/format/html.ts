// Regex-only HTML handling: the format code runs under node, in Zotero and in
// Python, so it may not lean on a DOM.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function unescapeHtml(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED[body.toLowerCase()] ?? whole;
    },
  );
}

/**
 * The text of the first `<pre>` carrying `data-<attribute>="1"`, with any tags
 * the note editor put inside it removed (`<br>` read as a newline) and
 * entities decoded; null when no such block exists. `attribute` must be
 * letters and hyphens.
 */
export function extractDataBlock(
  html: string,
  attribute: string,
): string | null {
  const pattern = new RegExp(
    `<pre\\b[^>]*\\bdata-${attribute}\\s*=\\s*["']?1["']?[^>]*>([\\s\\S]*?)</pre>`,
    "i",
  );
  const match = pattern.exec(html);
  if (!match) return null;
  return unescapeHtml(
    match[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""),
  );
}

export function dataBlock(attribute: string, json: string): string {
  return `<pre data-${attribute}="1">${escapeHtml(json)}</pre>`;
}
