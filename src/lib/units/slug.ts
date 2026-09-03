// ============================================================
// Slug generation for `unidades`. Shared by POST (create) and
// PATCH (rename, which re-slugs) in the units CRUD API.
//
// Rule: lowercase, spaces -> '-', strip anything that isn't
// alphanumeric or '-', collapse repeated '-'. Accents are also
// stripped (via NFD + combining-mark removal) before that pass —
// unit names in this app are typically Portuguese ("Unidade Sao
// Paulo", "Matriz Jaragua") and a slug that drops every accented
// letter's base character would read as mangled rather than clean.
// ============================================================

// Unicode "Combining Diacritical Marks" block (U+0300-U+036F). Built
// from char codes rather than a literal regex range so the source
// file contains no raw combining characters of its own.
const COMBINING_MARKS = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g",
);

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_MARKS, "") // strip combining accent marks
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
