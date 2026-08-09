import { PortalClient, PortalError } from "../client.js";
import {
  clampLimit,
  DEFAULT_RESULTS,
  formatArticle,
  formatRepos,
  formatSearchResults,
  MAX_RESULTS,
} from "../tools.js";

const hit = (over: Partial<Parameters<typeof formatSearchResults>[1][number]> = {}) => ({
  repo: "Alpha",
  slug: "signing-in",
  title: "Signing in",
  matchedHeadings: [],
  score: 8,
  ...over,
});

describe("clampLimit", () => {
  it("defaults when nothing usable is given", () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_RESULTS);
    expect(clampLimit("10")).toBe(DEFAULT_RESULTS);
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_RESULTS);
  });

  // A caller asking for a million is asking for every article its token can
  // read, which is a slow query and a huge response.
  it("caps what a caller asks for, in both directions", () => {
    expect(clampLimit(1_000_000)).toBe(MAX_RESULTS);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(7.9)).toBe(7);
  });
});

describe("formatSearchResults", () => {
  it("says nothing about what was NOT returned", () => {
    // "3 of 40 match, you may read 3" would disclose that 37 exist. The portal
    // already declined to mention them; repeating a total here would undo that.
    const text = formatSearchResults("auth", [hit(), hit({ slug: "b", title: "B" })]);

    expect(text).toContain('2 articles match "auth"');
    expect(text).not.toMatch(/\bof \d+\b/);
    expect(text).not.toMatch(/withheld|hidden|restricted|denied/i);
  });

  it("reports an empty result without hinting that anything exists", () => {
    const text = formatSearchResults("kubernetes", []);
    expect(text).toBe('No articles match "kubernetes".');
    expect(text).not.toMatch(/permission|access|entitled/i);
  });

  it("labels source roles as provenance, not as permission", () => {
    const text = formatSearchResults("auth", [hit({ writtenFor: ["Support"] })]);
    expect(text).toContain("written for: Support");
    // Without the qualifier a model reads this as an access rule and starts
    // telling people what they may read.
    expect(text).toContain("as labelled by its source");
  });

  // The first version of this test asserted "1 article match", which encoded
  // the bug rather than catching it -- `toContain` passed on a prefix of the
  // broken string.
  it("agrees with itself on singular and plural", () => {
    expect(formatSearchResults("a", [hit()])).toContain('1 article matches "a"');
    expect(formatSearchResults("a", [hit(), hit({ slug: "b" })])).toContain(
      '2 articles match "a"',
    );
  });

  it("includes what a follow-up call needs", () => {
    const text = formatSearchResults("auth", [hit()]);
    expect(text).toContain("repository: Alpha");
    expect(text).toContain("slug: signing-in");
    expect(text).toContain("get_article");
  });
});

describe("formatArticle", () => {
  it("renders the body under its heading", () => {
    const text = formatArticle({
      repo: "Alpha",
      slug: "signing-in",
      title: "Signing in",
      section: "general",
      summary: "How to sign in.",
      writtenFor: ["Support"],
      body: "## Steps\n\nDo the thing.",
    });

    expect(text).toContain("# Signing in");
    expect(text).toContain("How to sign in.");
    expect(text).toContain("Do the thing.");
    expect(text).toContain("as labelled by its source");
  });

  it("omits the optional lines rather than printing empties", () => {
    const text = formatArticle({
      repo: "Alpha",
      slug: "x",
      title: "X",
      section: "general",
      summary: null,
      writtenFor: null,
      body: "Body.",
    });

    expect(text).not.toContain("written for");
    expect(text).not.toContain("null");
  });
});

describe("formatRepos", () => {
  it("says what is available and nothing about what is not", () => {
    expect(formatRepos([])).toBe("There are no repositories available to this token.");
    expect(formatRepos([])).not.toMatch(/\bof \d+\b/);
  });

  it("lists names and counts", () => {
    const text = formatRepos([{ name: "Alpha", articles: 12 }]);
    expect(text).toContain("1 repository is available");
    expect(text).toContain("- Alpha (12 articles)");
    expect(formatRepos([{ name: "A", articles: 1 }, { name: "B", articles: 2 }])).toContain(
      "2 repositories are available",
    );
  });
});

describe("PortalError messages", () => {
  // The highest-risk surface in the whole package. Whoever writes an error
  // message is debugging at the time, so internal detail is exactly what is in
  // their head — and this text is shown to whoever is chatting.
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const clientFor = (respond: () => Promise<Response>) => {
    globalThis.fetch = respond as unknown as typeof fetch;
    return new PortalClient({
      url: "https://portal.example.invalid/",
      token: "s3cret-token-value",
      timeoutMs: 50,
    });
  };

  it("never repeats the token, the URL, or the portal's own error text", async () => {
    const client = clientFor(async () =>
      new Response(JSON.stringify({ error: "user 42 lacks grant on repo internal-ops" }), {
        status: 401,
      }),
    );

    let caught: unknown;
    try {
      await client.search("anything");
    } catch (error) {
      caught = error;
    }

    const message = (caught as PortalError).message;
    expect(caught).toBeInstanceOf(PortalError);
    expect(message).not.toContain("s3cret-token-value");
    expect(message).not.toContain("portal.example.invalid");
    expect(message).not.toContain("internal-ops");
    expect(message).not.toContain("user 42");
  });

  it("says the same thing for a missing article and a forbidden one", async () => {
    const client = clientFor(async () => new Response("{}", { status: 404 }));
    await expect(client.article("Alpha", "nope")).rejects.toThrow(
      /No such article, or the token's user may not read it/,
    );
  });

  it("does not leak the host when the portal cannot be reached", async () => {
    const client = clientFor(async () => {
      throw new Error("connect ECONNREFUSED 10.1.2.3:3000");
    });

    let message = "";
    try {
      await client.repos();
    } catch (error) {
      message = (error as PortalError).message;
    }

    expect(message).toBe("The portal could not be reached.");
    expect(message).not.toContain("10.1.2.3");
    expect(message).not.toContain("ECONNREFUSED");
  });
});

describe("PortalClient requests", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("normalises a trailing slash so the path is never doubled", async () => {
    let seen = "";
    globalThis.fetch = (async (url: string) => {
      seen = String(url);
      return new Response(JSON.stringify({ repos: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await new PortalClient({ url: "https://portal.example.invalid///", token: "t" }).repos();
    expect(seen).toBe("https://portal.example.invalid/api/repos");
  });

  it("sends the token as a bearer credential", async () => {
    let auth: string | null = null;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      auth = new Headers(init.headers).get("authorization");
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await new PortalClient({ url: "https://portal.example.invalid", token: "abc" }).search("x");
    expect(auth).toBe("Bearer abc");
  });

  it("escapes a slug so a crafted one cannot climb the path", async () => {
    let seen = "";
    globalThis.fetch = (async (url: string) => {
      seen = String(url);
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    await new PortalClient({ url: "https://portal.example.invalid", token: "t" }).article(
      "Alpha",
      "../../admin",
    );
    expect(seen).not.toContain("../");
    expect(seen).toContain("%2F");
  });
});
