/**
 * The matching rule of Deer's own searches.
 *
 * A search matches a row when the trimmed, lowercased query is a
 * substring of the row's text: the title, or the excerpt printed beside
 * it. The rule is deliberately not a fuzzy one — the same query has to
 * return the same rows as it did before the search was moved onto the
 * Command component, and a scattered approximation of the query would
 * return rows the reader never asked for.
 *
 * cmdk's own filter is such a fuzzy matcher (it scores a scattered
 * approximation of the query), so the Command lists are given this rule
 * instead.
 *
 * cmdk hands the row's *value* to the filter, and the value of a row here
 * is its id: an id such as "note-3f2a" would answer to a one-letter query
 * and pull in rows the reader never asked for. The text of the row
 * therefore travels in the keywords, and the value is left alone.
 */

/**
 * Whether the query is a substring of the text, ignoring case and the
 * spaces around the query. An empty query matches everything: it is the
 * state of a search that was never typed into.
 */
export function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return text.toLowerCase().includes(needle);
}

/**
 * The filter of the Command lists.
 *
 * cmdk reads a non-zero score as "this row matches", and every match
 * scores the same, so the rows keep the order of the list they were
 * given: filtering never reorders what the reader sees.
 *
 * The value is the row's identity and is not a text to search in; the
 * texts of the row are its keywords.
 */
export function commandTextFilter(
  _value: string,
  search: string,
  keywords: string[] = [],
): number {
  return keywords.some((keyword) => matchesQuery(keyword, search)) ? 1 : 0;
}
