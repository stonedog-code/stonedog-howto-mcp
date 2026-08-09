#!/usr/bin/env node
/**
 * A Model Context Protocol server for a how-to documentation portal.
 *
 * Runs over stdio, reads its configuration from the environment, and answers
 * as the user whose token it holds. It contains no documentation, no role
 * names and no permission model of its own — the portal decides, and this asks.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { PortalClient, PortalError } from "./client.js";
import { clampLimit, formatArticle, formatRepos, formatSearchResults, MAX_RESULTS } from "./tools.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    // Refuses at startup rather than at the first tool call. A server that
    // starts and then fails every request looks like a broken portal; one that
    // will not start names its own missing setting.
    console.error(`${name} is not set. See the README for configuration.`);
    process.exit(1);
  }
  return value.trim();
}

/** Any failure becomes tool output rather than a crash. */
function asToolError(error: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const message =
    error instanceof PortalError
      ? error.message
      : // Deliberately not `error.message`: an unexpected error's text can carry
        // a URL, a file path, or a stack, and this string is shown to whoever is
        // chatting.
        "Something went wrong talking to the portal.";
  return { content: [{ type: "text", text: message }], isError: true };
}

const server = new McpServer({ name: "stonedog-howto-mcp", version: "0.1.0" });

const client = new PortalClient({
  url: requiredEnv("HOWTO_PORTAL_URL"),
  token: requiredEnv("HOWTO_API_TOKEN"),
});

server.registerTool(
  "search_articles",
  {
    title: "Search how-to articles",
    description:
      "Search the how-to documentation across every repository this token may read. " +
      "Ranked by relevance: titles outrank summaries, which outrank headings, which outrank prose. " +
      "Every word in the query must appear, so adding a word narrows the results. " +
      "Returns only articles the token's user is entitled to read.",
    inputSchema: {
      query: z.string().min(1).describe('What to look for, e.g. "authentication"'),
      limit: z.number().int().min(1).max(MAX_RESULTS).optional()
        .describe(`Maximum results (default 10, maximum ${MAX_RESULTS})`),
      repo: z.string().optional().describe("Restrict to one repository by name"),
    },
  },
  async ({ query, limit, repo }) => {
    try {
      const hits = await client.search(query, {
        limit: clampLimit(limit),
        ...(repo !== undefined ? { repo } : {}),
      });
      return { content: [{ type: "text" as const, text: formatSearchResults(query, hits) }] };
    } catch (error) {
      return asToolError(error);
    }
  },
);

server.registerTool(
  "get_article",
  {
    title: "Read a how-to article",
    description:
      "Read one article in full, by the repository and slug that `search_articles` returned. " +
      "Refuses identically whether the article does not exist or the token's user may not read it.",
    inputSchema: {
      repo: z.string().min(1).describe("Repository name, as returned by search"),
      slug: z.string().min(1).describe("Article slug, as returned by search"),
    },
  },
  async ({ repo, slug }) => {
    try {
      return {
        content: [{ type: "text" as const, text: formatArticle(await client.article(repo, slug)) }],
      };
    } catch (error) {
      return asToolError(error);
    }
  },
);

server.registerTool(
  "list_repos",
  {
    title: "List readable repositories",
    description:
      "The repositories this token may read, with how many articles each holds. " +
      "Says nothing about repositories it may not read.",
    inputSchema: {},
  },
  async () => {
    try {
      return { content: [{ type: "text" as const, text: formatRepos(await client.repos()) }] };
    } catch (error) {
      return asToolError(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
