/**
 * A thin HTTP client for a how-to portal.
 *
 * Deliberately thin. The portal decides what this may read — from the user its
 * token belongs to — and re-deciding any of that here would be a second answer
 * to the same question, which is how a client ends up showing something the
 * server would have refused.
 */

export interface PortalConfig {
  /** Base URL of the portal, without a trailing slash. */
  url: string;
  /** A token belonging to a portal user. Its holder reads what that user reads. */
  token: string;
  /** Milliseconds before a request is abandoned. Defaults to 10 seconds. */
  timeoutMs?: number;
}

export interface SearchHit {
  repo: string;
  slug: string;
  title: string;
  summary?: string;
  /**
   * The role names the SOURCE application wrote, kept as provenance. They do
   * not decide what this token may read — the portal already did that.
   */
  writtenFor?: string[];
  matchedHeadings: string[];
  score: number;
}

export interface FullArticle {
  repo: string;
  slug: string;
  title: string;
  section: string;
  summary: string | null;
  writtenFor: string[] | null;
  body: string;
}

export interface RepoSummary {
  name: string;
  articles: number;
}

/**
 * Something went wrong talking to the portal.
 *
 * The message is written for whoever is reading it in a chat window, not for
 * whoever is debugging this file. It never carries the URL, the token, a stack,
 * or the portal's own error text — an error message is the easiest place for
 * internal detail to escape, because whoever writes one is debugging at the
 * time and that is exactly what is in their head.
 */
export class PortalError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "PortalError";
    this.status = status;
  }
}

function describe(status: number): string {
  if (status === 401) {
    return "The portal did not accept the configured token. Check it is current and has not been revoked.";
  }
  if (status === 404) {
    return "No such article, or the token's user may not read it.";
  }
  if (status === 400) return "The portal rejected the request as malformed.";
  if (status >= 500) return "The portal reported an error.";
  return "The portal refused the request.";
}

export class PortalClient {
  readonly #url: string;
  readonly #token: string;
  readonly #timeoutMs: number;

  constructor({ url, token, timeoutMs = 10_000 }: PortalConfig) {
    // Normalised once, so a configured "https://host/" does not produce
    // "https://host//api/search" — which some servers 404 and others accept,
    // making it a bug that only appears on somebody else's deployment.
    this.#url = url.replace(/\/+$/, "");
    this.#token = token;
    this.#timeoutMs = timeoutMs;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#url}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${this.#token}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      // The cause is swallowed on purpose: a fetch failure's message contains
      // the host and port, and this text may be shown to somebody who should
      // not learn either.
      throw new PortalError("The portal could not be reached.");
    }

    if (!response.ok) throw new PortalError(describe(response.status), response.status);

    try {
      return (await response.json()) as T;
    } catch {
      throw new PortalError("The portal returned a response this client could not read.");
    }
  }

  async search(query: string, options: { limit?: number; repo?: string } = {}): Promise<SearchHit[]> {
    const body = await this.#request<{ results: SearchHit[] }>("/api/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.repo !== undefined ? { repo: options.repo } : {}),
      }),
    });
    return body.results;
  }

  async article(repo: string, slug: string): Promise<FullArticle> {
    return this.#request<FullArticle>(
      `/api/articles/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`,
    );
  }

  async repos(): Promise<RepoSummary[]> {
    const body = await this.#request<{ repos: RepoSummary[] }>("/api/repos");
    return body.repos;
  }
}
