import zotero from "@zotero-plugin/eslint-config";

export default [
  ...zotero(),
  { ignores: [".scaffold/**", "fixtures/**", "typings/i10n.d.ts"] },
];
