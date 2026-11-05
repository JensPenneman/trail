/**
 * Lower case, without accents and punctuation, "&" as "and": what a search
 * compares, so that "jose" finds "José" (Settings' search, the people list's).
 */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
