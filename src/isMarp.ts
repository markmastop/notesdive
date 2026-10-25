// Detection stays lightweight: the presentation engine is loaded with its viewer.
export function isMarp(text: string): boolean {
  const frontmatter = text.replace(/^\uFEFF/, "").match(/^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/);
  return !!frontmatter && /^marp:[^\S\r\n]*true[^\S\r\n]*(?:#.*)?$/im.test(frontmatter[1]);
}
