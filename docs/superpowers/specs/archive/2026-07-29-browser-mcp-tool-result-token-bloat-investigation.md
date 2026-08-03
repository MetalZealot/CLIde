# Browser MCP tool-result token-bloat investigation

*Recorded 2026-07-29 against CLIde `main`, Claude Code, and the inherited
`cloudcli-browser` MCP implementation.*

## Status

**CONFIRMED 2026-07-29 (Claude, `main` @ `5f31bf7`). Stages 1 and 2 complete;
Stage 3 not run and not needed. Cleared for implementation.**

**Archived 2026-08-01 after the fix landed in `ef604c5` and passed the focused,
build, and isolated live MCP verification recorded in `docs/todo-done.md`.**

See [Confirmation record](#confirmation-record-2026-07-29) at the end of this
document for the reproduced measurements, three corrections to the sections
below, and the [Implementation session brief](#implementation-session-brief).
The original handoff text is preserved unchanged below for provenance — where it
disagrees with the confirmation record, the record wins.

Original status: *Investigation handoff. Confirm independently before
implementing a fix.*

This document was written for a future Claude session. Its first job was to test
the report without trusting the conclusions recorded here. Do not begin by
editing the Browser implementation, restarting the production service, or
calling Browser MCP tools from the investigating Claude conversation.

The investigation can be completed in three stages:

1. trace the current source path;
2. measure the existing historical transcript without exposing its payload;
3. if independent live confirmation is still useful, exercise the MCP wire
   path against an isolated branch-test server while redirecting the raw result
   to a temporary file.

Stages 1 and 2 make no provider calls and consume no new Claude input tokens
beyond the investigation itself. Stage 3 also avoids putting the Browser result
in model context when performed as specified.

## Report to test

The built-in Browser MCP appears to return the current screenshot after nearly
every successful browser operation, including operations whose purpose is not
to take a screenshot. The screenshot is a JPEG encoded as a
`data:image/jpeg;base64,...` string inside the browser session object.

The MCP bridge then pretty-prints that object into an ordinary MCP `text`
content block:

```json
[
  {
    "type": "text",
    "text": "{\n  \"id\": \"...\",\n  \"screenshotDataUrl\": \"data:image/jpeg;base64,...\"\n}"
  }
]
```

If confirmed, this has four consequences:

- Claude Code may tokenize the base64 as ordinary text rather than receiving an
  MCP-native image content block.
- A screenshot that remains below Claude Code's tool-result limit may add tens
  of thousands of input tokens to the next model request.
- A larger screenshot may be offloaded by Claude Code to a local
  `tool-results/` file, replacing it in model context with a much smaller
  overflow notice. This safety behavior creates a size-dependent cliff rather
  than making the Browser MCP safe.
- The same screenshot may be returned repeatedly by navigate, click, type,
  keypress, wait, tab, list, snapshot, and stop operations.

Do not describe these points as confirmed-current until the steps below have
been performed against the then-current checkout.

## Safety and scope

### Required boundaries

- Keep this investigation read-only until the report is confirmed and the user
  separately asks for implementation.
- Do not print, open, render, copy, or paste any `screenshotDataUrl`.
- Treat the historical transcript and its `tool-results/` directory as
  sensitive user data. Report lengths and aggregate counts only.
- Do not print the Browser MCP bearer token. Keep shell tracing disabled around
  any command that loads it.
- Do not call `browser_create_session`, `browser_snapshot`,
  `browser_take_screenshot`, or another Browser MCP tool through the active
  Claude conversation during the low-risk confirmation stages. A native MCP
  tool result is exactly the context path under investigation.
- Do not restart `cloudcli.service`.
- Do not replace or stop an occupied branch-test server on port 3002. Inspect
  its status and ask the user before displacing another worktree.
- Do not modify `~/.cloudcli/auth.db`. The optional isolated probe may read the
  copied branch-test database.
- Do not navigate to credential, account, or user-content pages for this test.
  An empty initial page is sufficient to establish whether screenshots leak
  into ordinary results.

### Working-tree coordination

At the beginning of the future session:

```bash
git status --short
git branch --show-current
git worktree list
free -h
```

Preserve the existing untracked specs and all unrelated user work. Read the
then-relevant `TODO.md`, repository `AGENTS.md`, ignored `CLAUDE.md`, and any
new Browser-related ADR before proceeding.

## Current route hypothesis

The investigation should either confirm or falsify this entire route:

```text
Playwright page
  -> captureSession()
  -> JPEG Buffer
  -> data:image/jpeg;base64 string on BrowserUseSession
  -> publicSession()
  -> browser-use-mcp HTTP bridge
  -> jsonResponse(JSON.stringify(...))
  -> MCP content [{ type: "text", text: "..." }]
  -> Claude Code tool_result
  -> next Claude model request
```

The likely architectural cause is DTO reuse: CLIde's human-facing Browser panel
needs a screenshot in its session state, while the agent MCP route returns the
same public session object instead of a compact agent-facing summary.

## Stage 1: independently confirm the source path

### 1.1 MCP serialization

Inspect the MCP entrypoint without dumping built artifacts:

```bash
nl -ba server/browser-use-mcp.ts | sed -n '14,32p;80,100p;214,250p'
```

Check whether:

- `jsonResponse()` still calls `JSON.stringify(value, null, 2)`;
- `textResponse()` still wraps the result as `{ type: 'text', text }`;
- all tools, including screenshot tools, still pass their API result through
  `jsonResponse()`; and
- `browser_take_screenshot` has any special MCP image handling.

Confirmation criterion: a screenshot-bearing API object is serialized into a
text block with no `{ type: "image", data, mimeType }` content block.

### 1.2 API routing

```bash
nl -ba server/modules/browser-use/browser-use-mcp.routes.ts | sed -n '30,105p'
```

Check whether `browser_snapshot` and `browser_take_screenshot` still route to
the same service method. Record the service method used by every Browser MCP
tool.

### 1.3 Session projection and capture

```bash
nl -ba server/modules/browser-use/browser-use.service.ts \
  | sed -n '20,45p;345,398p;490,590p;595,790p'
```

Check all of the following:

- `BrowserUseSession` contains `screenshotDataUrl`;
- `publicSession()` removes only `ownerId`, or otherwise retains the screenshot;
- `captureSession()` captures a JPEG and constructs a base64 data URL;
- `createAgentSession()` captures before returning;
- `listAgentSessions()` maps sessions through the screenshot-bearing
  projection;
- navigate, click, type, fill, keypress, select, successful wait, and tab
  operations call `captureSession()` before returning; and
- stop/close returns a session that may still contain the last screenshot.

Record any differences rather than forcing the historical diagnosis onto
changed code.

### 1.4 Human Browser panel dependency

```bash
rg -n "screenshotDataUrl" src/components/browser-use server/modules/browser-use
```

Confirm whether the client Browser panel uses `screenshotDataUrl` to monitor the
session. This distinguishes a valid UI requirement from the separate question
of whether binary presentation data belongs in an agent tool result.

### 1.5 Provider and upstream scope

Check how enabling Browser registers `cloudcli-browser` across providers:

```bash
nl -ba server/modules/browser-use/browser-use.service.ts | sed -n '425,495p'
```

Do not call this a Claude-only server defect if the same MCP server is
registered for Claude, Codex, Cursor, and OpenCode. Provider clients may impose
different output limits, so runtime impact must still be reported per provider.

Before calling the defect upstream-wide, inspect the current upstream code
rather than relying on this document:

```bash
git log -1 --format='%h %ad %s' --date=iso upstream/main
git show upstream/main:server/modules/browser-use/browser-use-mcp.ts \
  | rg -n "textResponse|jsonResponse|browser_snapshot|browser_take_screenshot"
git show upstream/main:server/modules/browser-use/browser-use.service.ts \
  | rg -n "publicSession|captureSession|screenshotDataUrl|return publicSession"
```

The local `upstream/main` ref may be stale. Report its commit and date. If a
live-current upstream claim is necessary, refresh or query GitHub only within
the user's authorization. Search upstream issues and pull requests before
claiming no fix exists:

```bash
gh search issues "browser base64" --repo siteboon/claudecodeui --limit 20
gh search issues "browser screenshot tokens" --repo siteboon/claudecodeui --limit 20
gh search prs "browser MCP screenshot" --repo siteboon/claudecodeui --limit 20
```

Historical baseline only: the implementation was previously traced to upstream
commit `e8853917` (`Add browser use as MCP to providers`). Verify this with
`git blame`; do not assume it remains the operative origin.

## Stage 2: confirm historical behavior without a new Browser call

### 2.1 Locate the evidence

The observed session used this Claude transcript:

```text
/home/gnuthall/.claude/projects/-home-gnuthall-Projects-cloudcli-wt-settings-ia/52f317b7-2076-4576-a631-f72d28be42d3.jsonl
```

First verify that it is still the file containing the observed Browser session
ID, without printing the matching line:

```bash
rg -l --hidden --glob '*.jsonl' \
  '4ab80fac-a521-4a3d-884d-7d010d22baec' \
  /home/gnuthall/.claude/projects
```

Assign the exact returned path:

```bash
transcript=/home/gnuthall/.claude/projects/-home-gnuthall-Projects-cloudcli-wt-settings-ia/52f317b7-2076-4576-a631-f72d28be42d3.jsonl
ls -lh "$transcript"
wc -l -c "$transcript"
```

Do not run `cat`, plain `sed`, plain `rg -n`, or an editor preview on the
matching tool-result lines. They contain the payload being measured.

### 2.2 Count Browser calls

This reports tool names only:

```bash
jq -r '
  select((.message.content? | type) == "array")
  | .message.content[]
  | select(.type == "tool_use")
  | .name
' "$transcript" \
  | rg '^mcp__cloudcli-browser__' \
  | sort | uniq -c | sort -nr
```

Historical baseline to verify independently:

- 23 Browser MCP calls total;
- 6 clicks;
- 5 type operations;
- 4 navigations;
- 3 snapshots;
- 2 keypresses;
- 2 waits; and
- 1 create-session call.

Different counts mean the transcript changed or the wrong file was selected.

### 2.3 Measure results without printing them

The following command maps tool-result IDs back to tool names and emits only:

```text
tool name | classification | result characters | screenshot characters | body-text characters
```

```bash
jq -sr '
  [ .[]
    | select((.message.content? | type) == "array")
    | .message.content[]
  ] as $blocks
  | (reduce $blocks[] as $block ({};
      if $block.type == "tool_use"
      then .[$block.id] = $block.name
      else .
      end
    )) as $names
  | $blocks[]
  | select(.type == "tool_result")
  | ($names[.tool_use_id] // "unknown") as $name
  | select($name | startswith("mcp__cloudcli-browser__"))
  | (if (.content | type) == "string"
      then .content
      else ([.content[] | (.text? // "")] | join(""))
    end) as $text
  | (try ($text | fromjson) catch null) as $data
  | [
      ($name | sub("^mcp__cloudcli-browser__"; "")),
      (if $data != null
       then "direct-json"
       elif ($text | startswith("Error: result ("))
       then "offloaded"
       else "error-or-other"
       end),
      ($text | length),
      (if $data != null
       then (($data.screenshotDataUrl
              // $data.session.screenshotDataUrl
              // "") | length)
       else 0
       end),
      (if $data != null then (($data.text // "") | length) else 0 end)
    ]
  | @tsv
' "$transcript"
```

Historical baseline to test:

- the initial create-session result is direct JSON with 11,731 characters,
  including an 11,295-character screenshot data URL;
- the final navigation result is direct JSON with 31,407 characters, including
  a 30,831-character screenshot data URL;
- one wait operation is an ordinary timeout error; and
- 20 successful Browser results were replaced by Claude Code overflow notices
  approximately 1,378-1,388 characters long.

The exact compressed screenshot sizes may not be reproducible in a new run.
The important relationship is whether `screenshotDataUrl` dominates each
successful direct result.

### 2.4 Measure offloaded raw results

Do not read the files. Aggregate their sizes:

```bash
result_dir=/home/gnuthall/.claude/projects/-home-gnuthall-Projects-cloudcli-wt-settings-ia/52f317b7-2076-4576-a631-f72d28be42d3/tool-results

find "$result_dir" -maxdepth 1 -type f \
  -name 'mcp-cloudcli-browser-*' -printf '%s\n' \
  | awk '
      {
        count += 1
        total += $1
        if (min == 0 || $1 < min) min = $1
        if ($1 > max) max = $1
      }
      END {
        printf "files=%d total_bytes=%d min_bytes=%d max_bytes=%d avg_bytes=%.1f\n",
          count, total, min, max, count ? total / count : 0
      }
    '
```

Historical baseline:

```text
files=20
total_bytes=1195757
min_bytes=50841
max_bytes=64024
avg_bytes=59787.8
```

These files demonstrate the raw MCP output size. Their bytes should not be
reported as model tokens: Claude Code appears to have replaced them before the
next model request. Confirm that replacement from the transcript rather than
assuming it.

### 2.5 Verify token accounting

Claude transcript usage objects contain:

- `input_tokens`;
- `cache_creation_input_tokens`;
- `cache_read_input_tokens`; and
- `output_tokens`.

For this investigation, calculate the input footprint of one request as:

```text
input_tokens + cache_creation_input_tokens + cache_read_input_tokens
```

The historical line ranges below are clues for locating the two direct results.
Pipe them through `jq`; never print them directly:

```bash
for range in 317,323 486,492; do
  sed -n "${range}p" "$transcript" \
    | jq -r '
        [
          (.timestamp // ""),
          (.message.id // ""),
          (.message.role // ""),
          ([.message.content[]? | .type] | join(",")),
          ([.message.content[]?
            | select(.type == "tool_result")
            | (if (.content | type) == "string"
               then (.content | length)
               else ([.content[] | (.text? // "")] | join("") | length)
               end)
            | tostring
           ] | join(",")),
          (.message.usage.input_tokens // ""),
          (.message.usage.cache_creation_input_tokens // ""),
          (.message.usage.cache_read_input_tokens // ""),
          (.message.usage.output_tokens // "")
        ]
        | @tsv
      '
done
```

Claude transcripts may store multiple content blocks for one assistant API
message with the same message ID and repeated usage values. Deduplicate by
`message.id`; do not sum duplicate thinking/tool-use records.

Historical claims to recalculate:

- the request before the initial direct result had an input footprint of
  195,391 tokens;
- the next request had an input footprint of 207,059 tokens;
- the increase was 11,668 new input/cache-creation tokens;
- the request before the final direct result had an input footprint of
  254,180 tokens;
- the next request had an input footprint of 284,347 tokens; and
- the increase was 30,167 new input/cache-creation tokens.

The previous assistant tool call is also part of each new prompt segment, so do
not claim every one of those delta tokens is screenshot data. It is valid to
say the screenshot overwhelmingly dominates when the direct tool result is
11,731 or 31,407 characters and the remaining tool-call content is small.

The two observed request deltas total 41,835 input tokens. Treat this as a
historical measurement, not a universal screenshot-to-token conversion.

### 2.6 Interpret usage carefully

The transcript can establish that content entered the model input and was
reported in `cache_creation_input_tokens`. It cannot establish a precise
Pro/Max subscription-quota conversion because Anthropic does not expose that
formula.

The final report should distinguish:

- raw MCP response bytes;
- characters placed in the transcript;
- input/cache-write tokens reported by Claude;
- cache-read tokens on later requests;
- context-window occupancy;
- API billing, if API authentication was used; and
- Pro/Max plan usage, whose exact conversion is not public.

Do not describe locally offloaded 50-64 KB files as billed model input unless
the transcript or provider usage proves they were sent.

## Stage 3: optional isolated current-wire probe

Perform this only if Stages 1 and 2 confirm the historical defect but a
then-current runtime result is still useful.

### 3.1 Isolation prerequisites

1. Check whether `cloudcli-branch-test` is already serving another worktree.
2. Do not replace an occupied instance without the user's permission.
3. Use a clean, dedicated topic worktree from the then-current `main`; do not
   make the active Settings IA worktree carry this investigation.
4. Start the branch-test server on port 3002 with its SQLite snapshot.
5. Confirm Browser is enabled in the snapshot. Do not enable it by writing the
   database directly.

The purpose of port 3002 is to keep the browser session in the isolated server's
memory. Stopping the branch-test server removes that runtime state without
restarting production.

### 3.2 Capture the API response to disk

Use an automatically created temporary directory and keep the bearer token out
of output:

```bash
set +x
probe_dir=$(mktemp -d)
branch_db=/home/gnuthall/.local/state/cloudcli-branch-test/auth.db
browser_token=$(sqlite3 "$branch_db" \
  "SELECT value FROM app_config WHERE key = 'browser_use_mcp_token';")
api_url=http://127.0.0.1:3002/api/browser-use-mcp

test -n "$browser_token"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $browser_token" \
  -H 'Content-Type: application/json' \
  --data '{}' \
  "$api_url/tools/browser_create_session" \
  >"$probe_dir/create.json"
```

Do not print `create.json`. Report only safe metadata:

```bash
jq '
  {
    success,
    fields: (.data | keys),
    result_chars: (.data | tostring | length),
    screenshot_chars: (.data.screenshotDataUrl // "" | length),
    screenshot_prefix_ok:
      ((.data.screenshotDataUrl // "") | startswith("data:image/jpeg;base64,"))
  }
' "$probe_dir/create.json"
```

Expected confirmation:

- `screenshot_chars` is greater than zero;
- `screenshot_prefix_ok` is `true`; and
- the screenshot accounts for most of `result_chars`.

If the isolated Browser runtime is unavailable, stop and report the setup
condition. Do not alter production or install dependencies merely to force this
optional probe.

### 3.3 Capture the exact MCP wire result to disk

With the isolated session still alive, call `browser_list_sessions` through the
compiled MCP process. Redirect all stdout before parsing it:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"browser_list_sessions","arguments":{}}}' \
  | env \
      CLOUDCLI_BROWSER_USE_MCP_TOKEN="$browser_token" \
      CLOUDCLI_BROWSER_USE_API_URL="$api_url" \
      node dist-server/server/browser-use-mcp.js \
      >"$probe_dir/wire.json" \
      2>"$probe_dir/wire.err"
```

Never print `wire.json`. Extract only:

```bash
jq '
  {
    rpc_error: (.error.message // null),
    content_type: (.result.content[0].type // null),
    text_chars: (.result.content[0].text // "" | length),
    session_count:
      ((.result.content[0].text | fromjson) | length),
    first_screenshot_chars:
      ((.result.content[0].text | fromjson)
       | (.[0].screenshotDataUrl // "" | length))
  }
' "$probe_dir/wire.json"
```

The defect is confirmed on the current wire path if:

- `content_type` is `text`;
- `first_screenshot_chars` is greater than zero; and
- the text result contains the screenshot-bearing session.

The defect is changed or not reproduced if the ordinary list result omits the
screenshot, returns a compact reference, or uses a distinct MCP image block.

### 3.4 Cleanup

Capture the isolated session ID without printing it:

```bash
session_id=$(jq -r '.data.id' "$probe_dir/create.json")

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $browser_token" \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg sessionId "$session_id" '{sessionId: $sessionId}')" \
  "$api_url/tools/browser_close_session" \
  >"$probe_dir/close.json"
```

Then stop only the branch-test server started for this investigation. Do not
touch the production service. Remove the temporary directory only after
verifying that `probe_dir` is the `mktemp` path created above.

Closing a Browser agent session marks it stopped but may leave the session
record in that server's in-memory map. Stopping the isolated server is the
cleanup boundary.

## Confirmation matrix

| Question | Evidence | Confirmed when |
|---|---|---|
| Is a screenshot captured after ordinary actions? | Service source | Successful ordinary actions call `captureSession()` |
| Does the agent projection retain it? | `publicSession()` and route returns | `screenshotDataUrl` remains present |
| Is it MCP text rather than MCP image content? | MCP serializer and optional wire probe | `content[0].type === "text"` and inner JSON contains the data URL |
| Does Claude Code offload some large results? | Historical tool-result notices and `tool-results/` sizes | Raw files exist and transcript contains small replacement notices |
| Can smaller results enter model context? | Direct JSON tool results in transcript | Screenshot data URL remains in the recorded `tool_result` |
| Did one result materially enlarge input? | Adjacent deduplicated usage objects | Next request shows a comparable increase in new input/cache-write tokens |
| Is the defect upstream-shared? | Current upstream source plus issue/PR check | Same route exists in a current upstream revision and no superseding fix is found |
| Is impact provider-neutral? | MCP registration and provider runtime probes | Same server is registered broadly; actual client behavior is reported separately |

## Required report from the confirming Claude session

Return a concise evidence table containing:

- CLIde commit and branch;
- local `upstream/main` commit/date;
- Claude Code version and model used for the historical session, if available;
- Browser tool-call count;
- direct-result character and screenshot lengths;
- offloaded file count and aggregate bytes;
- the two independently calculated input-footprint deltas;
- whether the current source still follows the hypothesized route;
- whether an isolated current-wire probe was run;
- whether any new provider usage was incurred;
- whether production or user data was changed; and
- conclusion: **confirmed**, **partially confirmed**, **changed**, or
  **not reproduced**.

State uncertainty explicitly. In particular:

- do not equate characters with tokens;
- do not equate cache-write tokens with an exact subscription-quota percentage;
- do not assume all MCP clients handle size limits like Claude Code; and
- do not call the overflow notice a complete safeguard.

## Repair direction after confirmation

This section is guidance, not authorization to implement.

### Agent-facing result contract

Split the human Browser panel's session projection from the MCP result
projection. Ordinary agent results should contain only compact state:

```ts
type AgentBrowserSessionSummary = {
  id: string;
  status: BrowserUseSessionStatus;
  url: string | null;
  title: string | null;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  viewport: { width: number; height: number } | null;
  cursor: { x: number; y: number; actor: 'agent' } | null;
};
```

Do not include `screenshotDataUrl` in:

- create;
- list;
- navigate;
- click;
- type;
- fill form;
- press key;
- select option;
- wait;
- tabs;
- stop; or
- ordinary snapshot metadata.

CLIde may continue capturing screenshots internally after actions so the human
Browser panel stays current. The fix concerns what crosses the agent/MCP
boundary, not whether the panel can render a live session.

### Explicit screenshot contract

`browser_take_screenshot` should return a real MCP image content block plus a
small text metadata block:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"sessionId\":\"...\",\"url\":\"...\",\"title\":\"...\"}"
    },
    {
      "type": "image",
      "data": "<base64 bytes without the data-URL prefix>",
      "mimeType": "image/jpeg"
    }
  ]
}
```

The MCP protocol version already advertised by this server supports image
content. Verify each provider client actually accepts it before declaring
provider parity. An image still consumes vision/context tokens; the goal is
correct typed delivery on explicit request, not zero-cost screenshots.

### Snapshot contract

`browser_snapshot` should return compact metadata plus bounded page text or a
more useful accessibility representation. It should not automatically include
the screenshot. Reassess the current 30,000-character body-text ceiling with a
documented output budget.

### Tests required for a future fix

At minimum:

- ordinary MCP actions never contain `data:image`;
- ordinary MCP action results stay below a strict byte/character budget;
- list results do not multiply screenshots by session count;
- `browser_take_screenshot` returns `type: "image"` with `mimeType:
  "image/jpeg"`;
- `browser_snapshot` omits screenshot bytes and enforces its text limit;
- the human Browser API and panel still receive the screenshot they require;
- create, click, type, wait, tabs, and stop retain correct metadata;
- Claude, Codex, Cursor, and OpenCode configurations continue to register or
  cleanly no-op according to their supported MCP capabilities; and
- error results remain concise and actionable.

Run the narrow server tests with the repository-standard command:

```bash
./node_modules/.bin/tsx --tsconfig server/tsconfig.json --test \
  '<matching browser-use *.test.ts files>'
```

Then run:

```bash
npm run typecheck
npm run lint
npm run build:server
```

Implementation should occur on a dedicated topic branch/worktree. Verify the
server build on port 3002 with `cloudcli-branch-test`; do not merge, push, or
restart production until Grayson has personally verified the live behavior.

## Non-goals

- Redesigning the Browser panel.
- Removing screenshots from the human monitoring UI.
- Hand-tuning JPEG quality as the primary fix.
- Relying on Claude Code's overflow cutoff as the response budget.
- Hiding the base64 only in CLIde's transcript renderer while continuing to
  send it to the provider.
- Claiming screenshot input is free when transported as an MCP image.
- General MCP architecture consolidation unrelated to the confirmed boundary.
- Modifying real user sessions, credentials, or the production database.

## ADR and upstream disposition

If the repair is only a DTO-boundary correction using standard MCP image
content, it likely does not need a new ADR. Ask whether an ADR is warranted if
the implementation establishes a broader, lasting rule for binary MCP result
budgets or provider capability negotiation.

The defect appears suitable for an upstream contribution because it originates
in shared Browser MCP behavior rather than CLIde-specific product policy.
Prepare an upstreamable commit separately, but do not open, push, or update an
upstream pull request without the user's explicit approval.

---

# Confirmation record (2026-07-29)

*Confirmed by a Claude session against `main` @ `5f31bf7`, clean working tree.
Stages 1 and 2 were run in full. Stage 3 was deliberately skipped: Stage 1 read
the exact serializer that runs in production, so a wire probe would only
re-verify what the source already proves. No Browser MCP tool was called from
the confirming conversation, no provider tokens were spent, and nothing in
production or user data was modified.*

## Verdict: confirmed

Every quantitative baseline in the handoff reproduced **exactly** — not
approximately. The source path is unchanged from the one hypothesized.

| Item | Result |
|---|---|
| CLIde branch / commit | `main` @ `5f31bf7`, tree clean |
| Local `upstream/main` | `264e094`, 2026-07-29 19:11 UTC (`chore(release): v1.37.0`) — fresh, not stale |
| Historical session | Claude Code `2.1.220`, model `claude-sonnet-5` |
| Browser tool calls | **23** — 6 click, 5 type, 4 navigate, 3 snapshot, 2 wait, 2 press_key, 1 create_session |
| Direct result #1 (`browser_create_session`) | 11,731 chars; screenshot 11,295 = **96.3%** |
| Direct result #2 (`browser_navigate`) | 31,407 chars; screenshot 30,831 = **98.2%** |
| Offloaded raw files | `files=20 total_bytes=1195757 min=50841 max=64024 avg=59787.8` |
| Input-footprint delta #1 | 195,391 → 207,059 = **+11,668**, entirely `cache_creation_input_tokens` |
| Input-footprint delta #2 | 254,180 → 284,347 = **+30,167**, entirely `cache_creation_input_tokens` |
| Route hypothesis | Confirmed intact, end to end |
| Upstream-shared | Yes — upstream's copy is behaviourally identical |
| Provider-neutral | Yes — registered to every provider in the live registry |
| Prior upstream report | None found (issues open+closed, PRs) |

Message IDs for the two deltas, for anyone re-deriving them: `msg_011CdWkrAkYgKwHNnuFye2Uj`
→ `msg_011CdWkrbkwrHKag974BHWKV` (direct result at transcript line 318), and
`msg_011CdWmSPTyCcjD9RA73LMNx` → `msg_011CdWmT43hM8VFRJJoexZrp` (line 487).
Assistant records are duplicated per content block, so deduplicating by
`message.id` is mandatory — the handoff was right to warn about this.

## Two findings the handoff did not claim

**The offload replacement is now positively confirmed, not assumed.** Section 2.4
correctly refused to assert this. Requests following an offloaded result show
`cache_creation_input_tokens` of only ~200–2,300 (transcript line 333: 865; line
364: 212; line 396: 2,001) — consistent with a ~1,380-char notice plus a small
tool call, and nowhere near the 50–64 KB raw files. Claude Code did substitute
them before the next model request. The 1.19 MB of `tool-results/` bytes were
**not** billed as model input.

**41,835 tokens is a floor, not the session cost.** Once a screenshot enters the
cached prefix it is re-read on every subsequent request for the rest of the
session. 93 distinct requests followed the first direct result and 40 followed
the second, so those two screenshots account for roughly
`11,668 × 93 + 30,167 × 40 ≈ 2.3M` cache-read tokens carried forward. This is an
arithmetic projection from prefix structure, not a direct measurement, and cache
reads are much cheaper than cache writes — but it means the per-call figure
materially understates session impact. Two screenshots also permanently occupied
~42K of a 200K-class context window.

## Three corrections to the handoff text above

1. **Path divergence from upstream (affects Stage 1.5 and the v1.37.0 work).**
   This fork keeps the MCP entry at **`server/browser-use-mcp.ts`**; upstream
   v1.37.0 has it at **`server/modules/browser-use/browser-use-mcp.ts`**, moved
   in `06e7ee9` (`feat: numerous bugfixes and features (#1037)`). The handoff's
   `git show upstream/main:server/modules/browser-use/browser-use-mcp.ts`
   silently returned nothing when run against the fork's path assumption.
   Re-checked at the correct path, upstream's `jsonResponse` /
   `browser_take_screenshot` handling is identical. Coordinate with
   `2026-07-29-upstream-v1.37.0-integration` — the fix will land on a file
   upstream has relocated.
2. **`browser_snapshot` and `browser_take_screenshot` are literally the same
   call.** Both route to `browserUseService.agentSnapshot(sessionId)`
   (`browser-use-mcp.routes.ts`, the shared `case` pair), which returns
   `{ session: publicSession(session), text: text.slice(0, 30_000) }`. So the
   dedicated screenshot tool *also* drags up to 30 KB of body text, and the
   snapshot tool *also* drags the screenshot. The repair section's separate
   "explicit screenshot contract" and "snapshot contract" therefore require
   **splitting one service method into two**, not just changing two serializers.
3. **`gh search issues --state all` is rejected** by the installed `gh`; only
   `open` or `closed`. Run each query twice. The multi-word queries in Stage 1.5
   return zero results not because search is broken but because no such report
   exists.

## Confirmed call-site inventory

Line numbers are as of `5f31bf7` — **grep the symbol, don't trust the number.**

`captureSession()` is invoked before returning on **every** agent operation:
`createAgentSession` (~573), `agentNavigate` (~622), `agentSnapshot` (~632),
`agentClick` (~660), `agentType` (~684), `agentFillForm` (~703),
`agentPressKey` (~715), `agentSelectOption` (~730), `agentWaitFor` (~749),
`agentTabs` (~782). `publicSession()` strips only `ownerId` (~352), so
`screenshotDataUrl` (type field, ~33) survives all of them.
`stopSession` returns `publicSession(session)` (~805) still carrying the last
screenshot. `listAgentSessions` (~583) maps every session through the same
projection, so a list multiplies the screenshot by session count —
`MAX_SESSIONS_PER_OWNER` defaults to **3**, so a list can return ~3 screenshots
in one text block. `SESSION_TTL_MS` is 30 min.

---

# Implementation session brief

Everything below is preparation for the dedicated implementation session. The
[Repair direction](#repair-direction-after-confirmation) section above still
governs *what* to build; this section records *where it plugs in* and *what has
already been settled*, so the next session does not re-derive it.

## Session start checklist

```bash
cd /home/gnuthall/Projects/cloudcli
git status --short && git branch --show-current && git worktree list
free -h
```

Then, per the repo's concurrent-session rule, isolate in a worktree — this is a
**server** change, so it cannot be verified on 3001 without a production
restart:

```bash
git worktree add ../cloudcli-wt-browser-dto -b fix/browser-mcp-dto main
scripts/setup-worktree.sh /home/gnuthall/Projects/cloudcli-wt-browser-dto
```

`setup-worktree.sh` must be run from the **main checkout** and handles the
gitignored files plus a free port pair. Critically, it must not leave
`node_modules/.cache/tsbuildinfo/*.tsbuildinfo` symlinked to the main
checkout's — a shared tsbuildinfo makes `tsc` emit **no `dist-server/` at all**
while reporting success, and the branch-test server then crash-loops on
`Cannot find module .../dist-server/server/index.js`. Verify those are real
files in the worktree before the first build.

Claim the work in `TODO.md` (`— in progress on fix/browser-mcp-dto`) and commit
that claim first, so a concurrent session sees it.

## The seam: two projections, one capture

The human Browser panel and the agent MCP path currently share
`publicSession()`. They must not.

- **Human path — keep exactly as is.** `GET /api/browser-use/sessions`
  (`browser-use.routes.ts`) → `listSessions()` → `publicSession()`. The panel
  renders `selectedSession.screenshotDataUrl` directly
  (`BrowserUsePanel.tsx`, the `<img src>` and the fullscreen-button `disabled`
  guard). Changing this projection breaks live monitoring. Do not touch
  `captureSession()` either — the capture is a legitimate UI requirement.
- **Agent path — new projection.** Add an `agentSession()` (or
  `agentSessionSummary()`) function next to `publicSession()` returning the
  `AgentBrowserSessionSummary` shape from the repair section, and route every
  `agent*` service method through it instead. Export it so it can be unit-tested
  without a live browser.

Note that `listSessions()` and `listAgentSessions()` are already near-duplicates
differing only in the `enabled` check — after the split they diverge
meaningfully, which is the point.

## Splitting snapshot from screenshot

`agentSnapshot()` currently serves both tools. Split into:

- `agentSnapshot(sessionId)` → compact metadata + bounded page text, **no**
  screenshot. Reassess the 30,000-char text ceiling with a documented budget.
- `agentScreenshot(sessionId)` → returns the raw base64 **and** its mime type,
  so the MCP layer can emit a real image block.

Update the `case 'browser_snapshot': case 'browser_take_screenshot':` pair in
`browser-use-mcp.routes.ts` to route to the two different methods, and the
`browser_take_screenshot` case in `browser-use-mcp.ts` to build
`{ type: 'image', data, mimeType }` rather than `jsonResponse(...)`. Also fix the
now-inaccurate `browser_snapshot` tool **description**, which currently promises
"screenshot data URL" — the description is part of the model's prompt, so a stale
one keeps inviting the old usage.

Mechanical detail: the service stores only the assembled data URL
(`data:image/jpeg;base64,${...}`). An MCP image block needs the bare base64
without the prefix, so either strip the prefix at the boundary or keep the raw
base64 alongside the data URL on the session. Prefer the latter only if it does
not double memory per session.

MCP capability is not a blocker: the server already advertises
`protocolVersion: '2024-11-05'` in its `initialize` response, which supports
image content. Per the repair section, still verify each provider client
actually accepts it before claiming parity.

## Settled vs. open

**Settled by the confirmation** — no need to revisit:

- The defect is real, current, upstream-shared, and provider-neutral.
- The screenshot, not the metadata or body text, is what dominates the payload.
- Claude Code's offload is a size cliff, not a safeguard.
- The human panel genuinely needs `screenshotDataUrl`; the agent boundary does
  not.

**Open decisions for Grayson** — ask before implementing, don't assume:

1. Should `browser_take_screenshot` return an MCP image block at all, or should
   it return a compact reference (a session id + a note to view the Browser
   panel)? An image block is correct MCP typing but still costs vision tokens on
   every call. The handoff recommends the image block; the cheaper option is
   worth one question.
2. What is the byte/char budget for an ordinary agent action result? The tests
   below need a concrete number to assert against.
3. New `browser_snapshot` text ceiling — keep 30,000 or lower it?

## Test strategy

`server/modules/browser-use/tests/browser-use.service.test.ts` is currently
**one 332-byte test** asserting `listSessions()` starts empty. There is no
Playwright harness, and the `agent*` methods all require a live `handles` entry —
so do not plan on driving a real browser in unit tests.

The tractable approach: export the projection function and test it directly
against a hand-built session object containing a fake `screenshotDataUrl`. That
covers the highest-value assertions from the repair section's test list —
"ordinary MCP results never contain `data:image`", the size budget, and "list
does not multiply screenshots by session count" — without any browser at all.
Reserve live-browser verification for the manual pass on 3002.

Run tests with the repo-standard invocation (a directory arg fails; the `@/`
alias needs the tsconfig):

```bash
npx tsx --tsconfig server/tsconfig.json --test 'server/modules/browser-use/tests/*.test.ts'
npm run typecheck
npm run lint
```

## Verification plan

This is a server change, so `build:client` + refresh does **not** deploy it, and
production must not be restarted for testing. Merge to `main` only after
verification.

```bash
cloudcli-branch-test start /home/gnuthall/Projects/cloudcli-wt-browser-dto
```

Grayson verifies on **`http://nuthallpi.tailb083b8.ts.net:3002`** — never 3001,
which serves the main checkout's build. Check both halves: the Browser panel
still shows a live screenshot, and an agent Browser call in a 3002 session
returns a small result. Provider homes are shared with production, so use an
obvious test-session name and clean up any stray transcript file (filesystem
before database rows).

Remember the branch-test snapshot carries the existing login — Grayson clicks
through; the implementing session hands over the URL and says what to look for.

## Disposition

- **ADR**: likely unnecessary if this stays a DTO-boundary correction using
  standard MCP image content. Prompt "worth an ADR?" if the work ends up
  establishing a general rule for binary MCP result budgets or provider
  capability negotiation.
- **Upstream**: confirmed upstream-shared with no existing issue or PR, so it is
  a genuine upstream candidate. Record it in `docs/upstream-candidates.md` when
  the fix lands. Note the upstream file has moved to
  `server/modules/browser-use/browser-use-mcp.ts`, so the patch will need
  rebasing onto that path. Do not open or push an upstream PR without explicit
  approval.
- **Non-goals** in the section above still hold — in particular, do not "fix"
  this by lowering JPEG quality or by hiding the base64 in CLIde's transcript
  renderer while still sending it to the provider.
