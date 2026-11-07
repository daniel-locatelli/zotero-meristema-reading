import type { LibraryLink } from "../format/common";
import type { PaperRef } from "../format/readState";

export function libraryLinkOf(libraryID: number): LibraryLink {
  const library = Zotero.Libraries.get(libraryID) as any;
  return library?.libraryType === "group"
    ? { kind: "group", id: Zotero.Groups.getGroupIDFromLibraryID(libraryID) }
    : { kind: "user" };
}

/** The paper behind an item, for its read-state id: its DOI field, else its library and key. */
export function paperRefOf(item: Zotero.Item): PaperRef {
  return {
    doi: String(item.getField("DOI") ?? "") || null,
    library: libraryLinkOf(item.libraryID),
    key: item.key,
  };
}

/** A standalone note, not in the trash, carrying `tag`. */
export function isTaggedNote(item: Zotero.Item, tag: string): boolean {
  return (
    item.isNote() && item.isTopLevelItem() && !item.deleted && item.hasTag(tag)
  );
}

/** The standalone, untrashed notes in a library that carry `tag`. */
export async function taggedNotes(
  libraryID: number,
  tag: string,
): Promise<Zotero.Item[]> {
  const tagID = Zotero.Tags.getID(tag);
  if (!tagID) return [];
  const ids = await Zotero.Tags.getTagItems(libraryID, tagID);
  const items = await Zotero.Items.getAsync(ids);
  return items.filter((item: Zotero.Item) => item && isTaggedNote(item, tag));
}
