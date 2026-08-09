/**
 * The tools, and how their results are written.
 *
 * Kept apart from the transport so they can be tested without a running server
 * or a stdio pipe — the formatting is the part with judgement in it, and the
 * part most likely to leak something it should not.
 */

import type { FullArticle, RepoSummary, SearchHit } from "./client.js";

/** Cap on results, whatever a caller asks for. */
export const MAX_RESULTS = 50;
export const DEFAULT_RESULTS = 10;

export function clampLimit(requested: unknown): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return DEFAULT_RESULTS;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_RESULTS);
}

/**
 * Search results, as text a model can act on.
 *
 * Says what was found and nothing about what was not. "3 of 40 articles match,
 * you may read 3" would disclose that 37 exist — the portal already declined to
 * mention them, and repeating the count here would undo that.
 */
export function formatSearchResults(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) {
    return `No articles match "${query}".`;
  }

  const lines = hits.map((hit) => {
    const parts = [`## ${hit.title}`, `repository: ${hit.repo} · slug: ${hit.slug}`];
    if (hit.summary) parts.push(hit.summary);
    if (hit.writtenFor && hit.writtenFor.length > 0) {
      // Provenance. Worth showing so a reader can judge whether an article
      // applies to them; it grants nothing, and saying so keeps a model from
      // reporting it as a permission.
      parts.push(`written for: ${hit.writtenFor.join(", ")} (as labelled by its source)`);
    }
    if (hit.matchedHeadings.length > 0) {
      parts.push(`matched headings: ${hit.matchedHeadings.join(" · ")}`);
    }
    return parts.join("\n");
  });

  const noun = hits.length === 1 ? "article matches" : "articles match";
  return [
    `${hits.length} ${noun} "${query}".`,
    "",
    lines.join("\n\n"),
    "",
    "Use `get_article` with a repository and slug to read one in full.",
  ].join("\n");
}

export function formatArticle(article: FullArticle): string {
  const header = [`# ${article.title}`, `repository: ${article.repo} · slug: ${article.slug}`];
  if (article.summary) header.push(article.summary);
  if (article.writtenFor && article.writtenFor.length > 0) {
    header.push(`written for: ${article.writtenFor.join(", ")} (as labelled by its source)`);
  }
  return [...header, "", article.body].join("\n");
}

export function formatRepos(repos: RepoSummary[]): string {
  if (repos.length === 0) {
    // Not "you have access to 0 of 4". What exists but is unreadable is not
    // this client's to mention.
    return "There are no repositories available to this token.";
  }
  const noun = repos.length === 1 ? "repository is" : "repositories are";
  return [
    `${repos.length} ${noun} available:`,
    "",
    ...repos.map((repo) => `- ${repo.name} (${repo.articles} articles)`),
  ].join("\n");
}
