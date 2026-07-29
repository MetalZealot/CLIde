# Browser MCP tool-result token-bloat investigation

*Recorded 2026-07-29 against CLIde `main`, Claude Code, and the inherited
`cloudcli-browser` MCP implementation.*

## Status

**Investigation handoff. Confirm independently before implementing a fix.**

This document is written for a future Claude session. Its first job is to test
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
