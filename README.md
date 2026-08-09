# @stonedogcode/howto-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for a how-to
documentation portal. Ask what has been written, and read it, without leaving
your editor.

```
> What articles exist about authentication?

3 articles match "authentication".

## Signing in with a passkey
repository: Alpha · slug: signing-in-with-a-passkey
written for: Support (as labelled by its source)
matched headings: Registering a device
…
```

**It contains no documentation of its own**, and no permission model. It asks a
portal, and the portal answers as the user whose token it holds.

## Install

```bash
npm install -g @stonedogcode/howto-mcp
```

Or run it without installing, which is what most MCP clients do:

```bash
npx @stonedogcode/howto-mcp
```

## Before you configure it

**The portal has to be running and reachable from this machine.** This server is
a client and holds nothing of its own, so a portal that is down looks exactly
like a server that is broken.

Check it first, so a later failure has one fewer possible cause:

```bash
curl -s https://howto.example.com/api/health
# {"status":"ok", … ,"database":"ok"}
```

`status: degraded` means the portal is up but its database is not. Fix that
before going further — search will fail and the error will point here.

**And you need a token.** Your portal issues them; how depends on the portal.
Whatever the mechanism, the token is shown **once** and stored hashed, so keep
it when it is printed. See "The token is an identity, not a key" below before
choosing whose it is.

## Configure

Two environment variables, both required. The server refuses to start without
them rather than failing every request afterwards — a server that starts and
then refuses everything looks like a broken portal.

| | |
| --- | --- |
| `HOWTO_PORTAL_URL` | Base URL of your portal, e.g. `https://howto.example.com` |
| `HOWTO_API_TOKEN` | A token issued by that portal |

### Claude Code

```bash
claude mcp add howto --scope user \
  --env HOWTO_PORTAL_URL=https://howto.example.com \
  --env HOWTO_API_TOKEN=… \
  -- npx -y @stonedogcode/howto-mcp
```

`--scope user` registers it for **every** project rather than the directory you
happen to be in. Documentation is not project-specific, and a server registered
in one checkout is invisible from the next one — which reads as the server
having stopped working.

Then confirm it, rather than assuming:

```bash
claude mcp list
# howto: npx -y @stonedogcode/howto-mcp - ✔ Connected
```

`✔ Connected` means the server started and answered. It does **not** mean the
token is good — that is not checked until the first search, by design, because
the portal is the thing that decides.

**Restart Claude Code** before expecting the tools in a session that was already
open. Then ask it something:

> What articles exist about authentication?

### Any client that takes a JSON config

```json
{
  "mcpServers": {
    "howto": {
      "command": "npx",
      "args": ["-y", "@stonedogcode/howto-mcp"],
      "env": {
        "HOWTO_PORTAL_URL": "https://howto.example.com",
        "HOWTO_API_TOKEN": "…"
      }
    }
  }
}
```

### When it does not work

The failures are deliberately hard to tell apart from the outside — that is the
access model working, not a bad error message — so here is what each one means.

| What you see | What it is |
| --- | --- |
| `HOWTO_PORTAL_URL is not set` | The variable did not reach the process. Client configs vary in whether they inherit your shell; set it in the config, not your profile. |
| `The portal could not be reached.` | Wrong URL, portal down, or a network path that does not exist from here. Try the `curl` above from the same machine. |
| `The portal did not accept the configured token.` | The token is wrong, revoked, or belongs to a deleted user. Issue a new one; the old value cannot be recovered. |
| `No articles match "…"` | The search ran and its user may read nothing that matches. This is also what you get when the token's user has no grants at all — see below. |
| `There are no repositories available to this token.` | The token is valid and its user has been granted nothing. Someone with admin rights on the portal grants repositories. |

The last two are worth reading twice: **a working setup with no access looks
almost exactly like a working setup with nothing to find.** If `list_repos` is
empty, the problem is grants, not configuration.

## The token is an identity, not a key

**This server reads exactly what its token's user reads — no more.** It performs
no access check of its own, deliberately: a second permission model beside the
portal's would be a second answer to the same question, and the two drift. A
client-side check that says yes when the server would say no is how a tool ends
up showing somebody something.

So the way to scope this server is to **choose whose token it is**. Issue it to
a user with the narrowest access that still makes the archive useful to you, and
revoke it when that person's access changes.

The token is long-lived and sits in a config file on disk. Treat it as you would
any credential in one.

## Tools

### `search_articles`

Search across every repository the token may read. Ranked by relevance — titles
outrank summaries, which outrank headings, which outrank prose — and every word
in the query must appear, so adding a word narrows the results.

| Argument | | |
| --- | --- | --- |
| `query` | required | What to look for |
| `limit` | optional | Default 10, maximum 50 |
| `repo` | optional | Restrict to one repository by name |

### `get_article`

Read one article in full, by the repository and slug that search returned.

### `list_repos`

The repositories this token may read, and how many articles each holds.

## What it will not tell you

Three things, on purpose, because a documentation tool that is careless here is
worse than none:

- **It never reports what it could not see.** No "3 of 40 match" — that would
  disclose that 37 exist. The portal declines to mention them; repeating a total
  would undo that.
- **A missing article and a forbidden one give the same answer.** Two different
  answers let a caller map what exists by guessing.
- **Errors carry no internals.** Not the URL, not the token, not the portal's own
  error text, not a stack. Error messages are where internal detail escapes
  most easily, because whoever writes one is debugging at the time.

Each of those has a test asserting it, including one that fails if an error
message ever repeats the token or the host.

## Requirements

Node 20 or newer, and a portal exposing `/api/search`, `/api/articles/…` and
`/api/repos` with bearer-token authentication.

## Licence

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
