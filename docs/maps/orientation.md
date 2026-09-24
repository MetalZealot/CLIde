# How CLIde works — orientation

Written for Grayson, not for an agent. Every other document in `docs/` assumes you
already know the architecture; this one doesn't. Each area names the one rule
that governs it and what goes wrong when the rule is broken.

Nothing here is implementation detail — it is the set of assumptions the code is built
on. When an agent proposes a change that contradicts one of these, that is the moment
to stop and ask, whether or not you can read the diff.

---

## 1. Every conversation has two IDs, and only one of them is an address

CLIde mints its own id for a session (`session_id`) and stores it in its database.
The provider — Claude Code, Codex — separately writes its own id (`provider_session_id`)
into its own transcript file on disk. They are different strings for the same
conversation.

**The rule:** a running process is only ever addressed by CLIde's id. The provider's id
is a lookup key — used to find the right file — never a way to reach a running session.

**What breaks:** send, abort, or resume goes to the wrong process or none at all, and a
single conversation splits into two sidebar rows. This caused three separate bugs in one
upstream merge, so it is the assumption most worth protecting.

## 2. Providers are adapters, and shared code must not know their names

Claude, Codex, Cursor and OpenCode each have a folder under
`server/modules/providers/list/`. Everything above them — the UI, the websocket layer,
the database — is supposed to work the same regardless of which one is running.

**The rule:** shared code asks *what can this provider do*, never *which provider is
this*. There are ten capability flags for exactly this (`supportsAbort`,
`supportsFork`, `supportsRewind`, `supportsImages`, and so on), served by
`provider-capabilities.service.ts`.

**What breaks:** a feature built for Claude with an `if (provider === 'claude')` check
either silently does nothing on Codex or crashes it. Because Claude is your daily
driver, you will not notice until you open a Codex session days later — which is
precisely the delayed-bug pattern.

## 3. The transcript file is the truth about what ran

Providers write an append-only log of the conversation to disk. CLIde reads it. Whatever
the UI shows, whatever the database recorded, whatever model you *think* was selected —
the transcript is the record of what actually happened.

**The rule:** read the transcript to establish what ran, but validate anything taken from
it before feeding it back into a command. It is trustworthy as history and untrustworthy
as input.

History pages may reuse a parsed transcript only while every contributing source still
has the same revision. Claude subagent files and Codex parent rollouts are part of that
source; an uncertain, partial, missing, or failed read is never retained as complete.

Unchanged messages should not be rebuilt when a new message arrives. An updated
reply or tool result must still appear immediately; skipping work must never
freeze what the conversation shows.

**What breaks:** a value scraped from an old transcript gets passed as a live model
argument, and a session silently resumes on a different model than it started on.

## 4. A watcher rediscovers anything left on disk

`sessions-watcher.service.ts` watches the providers' transcript directories and pushes
any session it finds into the sidebar automatically. This is how a session started
outside CLIde still shows up.

**The rule:** when removing a session, delete the file on disk *before* the database row.
Do it in the other order and the watcher re-adds it in the gap.

**What breaks:** deleted sessions reappear, and test runs leave real-looking projects and
conversations in your sidebar.

## 5. Token counting exists in three places that must agree

The number behind the context ring is assembled by three separate pieces of code: one
for the live stream, one for the API endpoint the UI polls, one for reading a session's
history. Claude also writes fake zero-usage rows into transcripts (error notices,
session-limit messages), and all three paths have to skip them identically.

**The rule:** any change to how Claude usage is counted gets made in all three, in the
same edit.

**What breaks:** the context ring goes blank or reads zero, usually only on sessions that
hit a limit — so it looks intermittent and unrelated to whatever was changed.

## 6. Merged, built, and live are three different facts

`dist/` is the browser code, built by `npm run build:client`. The server reads it from
disk on every request, so a rebuild plus a browser refresh is a complete deploy.
`dist-server/` is the backend, built by `npm run build:server`, and only a restart picks
it up. A merge changes source only; it does not install dependencies, rebuild either
artifact, or replace the already-running server process.

**The rule:** establish each boundary separately: source merged, dependencies current,
client and server built from that source, then the current server process running that
build. Frontend-only work can still use `build:client` then refresh; anything crossing
dependencies or the backend uses the production deployment path that verifies every
boundary.

**What breaks:** you refresh, see no change, and conclude the fix failed when it was
never built or loaded. Or “merged” is mistaken for “live” while production keeps serving
an older client, server, or dependency set.

## 7. Which port you check is not a judgment call

3001 is production, serving the main checkout. 3002 is the branch-test server, serving a
worktree. 5173 is the Vite dev server with hot reload, and it is pinned to the main
checkout.

**The rule:** verify on the port that serves the checkout that was edited. Work done on a
branch in a worktree does not exist on 3001, by definition.

**What breaks:** you're sent to refresh 3001 for a change that only exists on a branch,
see nothing, and both of you start debugging a bug that isn't there.

## 8. The database is outside the repo, so git cannot undo it

Your logins, sessions and project rows live in `~/.cloudcli/auth.db`, deliberately
outside the checkout so that working-tree changes can't destroy them. The tradeoff is
that `git checkout` and `git stash` can't rescue them either.

**The rule:** back it up before anything touching auth, schema, or migrations —
`cp ~/.cloudcli/auth.db ~/.cloudcli/auth.db.bak-<label>`. There is no other undo.

**What breaks:** a bad migration is permanent.

## 9. Documents have three types and hard size caps

A **map** (`docs/maps/`) answers "how does this work today". An **ADR**
(`docs/decisions/`) answers "what did we choose, and why". A **plan**
(`docs/plans/`) answers "what is left, in what order". `npm run check:docs` enforces a
byte cap on each — 8 KB for a plan, 24 KB for a map, 10 KB for an ADR.

**The rule:** when a document and reality disagree, edit the document. Never append a
correction or an audit section to preserve the wrong text.

**What breaks:** the caps exist because the previous system reached 317 KB across
eighteen files, one of them 79 KB, whose two largest sections were both audits appended
rather than edits made. Documents that expensive stop being read, and documents nobody
reads drift into being confidently wrong.

## 10. Accessibility sets a floor; it does not set CLIde's density

The web accessibility requirement for a pointer target is 24×24 CSS pixels, with
specific spacing and equivalent-control exceptions. Apple and Android recommend larger
touch targets for comfort, but those platform figures do not make every CLIde control
44px or 48px.

**The rule:** start with the established controls around the change, then consider
spacing, frequency, consequence, input method, and how it works on the actual device.
Use a larger invisible hit area when it helps without overlapping nearby actions.

**What breaks:** treating 44px as a universal rule makes compact menus and groups look
unrelated to the rest of CLIde, then forces repeated visual corrections after the
accessibility work was already technically complete.

## 11. A browser window belongs to the chat that opened it

Several chats can browse at once, and a browser can stay open while its agent is idle.

**The rule:** the Chat preview opens only a browser explicitly linked to that chat.
That browser belongs to the chat, not to the reply that opened it, so the page an
agent left is still there when you send the next message; it closes on Stop, when the
agent closes it, or after it sits unused. An open window alone does not mean the agent
is using it; the preview distinguishes active, idle, stopped, and unavailable states.
Questions and queued messages take priority over the thumbnail, which shrinks to a
text row in the normal layout. The Browser tab fits the whole capture between its
address and activity bars; Fullscreen offers closer scaling controls.

**What breaks:** guessing from whichever browser was used most recently can show
another chat's work, and treating an open window as activity leaves a false spinner.
If the browser reset between replies, an agent's first action each time would land on
a blank page it thought it had already navigated. Stretching a phone capture across
the desktop column makes it huge, while a tall capture pushes the activity line off
the phone screen.
Provider coverage and current limits: [Chat browser activity](chat-browser-activity.md).

## 12. Agents sign in to test servers without ever seeing the password

The test account lives only on the branch-test servers; your own account is on 3001.

**The rule:** the Browser opens test servers already signed in, from a saved sign-in
made when the test server starts. If a login form still appears, the agent types the
*name* of the secret and Playwright fills in the real value. Agents never read the
credentials file or write their own login script.

**What breaks:** an agent told "don't expose the password" but given no safe way to
enter it stops at the login form, then verifies in a separate hidden browser you can't
see in the Browser tab.

## 13. Mobile navigation stays in place before choosing a worktree

Shell, Files, and Git need a worktree; a new Chat can begin at the picker.

**The rule:** keep the bottom bar visible with Chat selected while choosing. Grey out
destinations that need a worktree, including entries inside More. The bar still hides
when the software keyboard opens.

**What breaks:** hiding the whole bar shifts the composer when a worktree is picked;
enabling dependent destinations leads to views with no working folder.

## 13. A usage limit is read from what the provider marks, not what it writes

A stopped turn carries the provider's own label for why — Claude stamps the row with a
quota record and a reset time, Codex names `usage_limit_exceeded`. The sentence you see
is localized wording that has already changed shape once.

**The rule:** anything that reacts to a limit — the Auto-Continue offer, a waiting
message — reads the label, never the sentence. And a reset is noticed when usage comes
back, not when the predicted time arrives, because providers reset early.

**What breaks:** matching the sentence stops working silently the next time it is
reworded. Waiting for the predicted time holds a message for up to a week after an early
reset, at exactly the moment it should have gone.

## 14. Nothing has a published place around the composer

Where things go in and around the composer is convention and taste; no standard says.
Four reasons decide it instead, written out in the UI standards map: how far your thumb
reaches, how little room the keyboard leaves, whether a thing affects the next message or
the whole session, and whether it is waiting on you.

**The rule:** name which of the four a placement rests on before building it. The strip
above the composer is the scarcest space on a phone, so it earns an item only when that
item needs you now — or, for queued messages, when it is about to send and you are
likely to change it first, and then as one row.
Questions share a collapsible frame: on a phone, collapse keeps the answer intact and
frees the conversation for scrolling. Expanded questions take at most half the
available screen height; their content scrolls inside while the controls stay visible.

**What breaks:** copying a desktop tool's layout fills that strip with cards that all
compete while you type, and each new feature adds one more.

---

## 15. On a phone the chat scrolls as the page, so overlays must lock it

In the installed app on your phone, the conversation scrolls as the whole page, because
that is the only way Android lets text-selection handles scroll along with your finger.
Browser tabs and desktop still scroll the chat inside a box.

**The rule:** anything that opens full-screen over the chat locks the page while it is
open, nothing moves the chat while you have text selected, and every bar floating over the
chat lets touches through while text is selected.

**What breaks:** a new full-screen screen without the lock lets your drags scroll the chat
underneath it, which is what the sidebar did. A new bar over the chat that still catches
touches makes selection handles slide under it or jump to the top again, and anything
floating over the chat that can be selected, even an empty one like the scrollbar, pulls
the selection into the composer. Putting the phone chat back in a box brings
back handles that jump to the top of the conversation
([ADR 0056](../decisions/0056-installed-phone-app-scrolls-the-chat-as-the-page.md)).

## 16. A preference either follows you across devices or belongs to one browser

Most preferences live in the browser's own storage, so they exist per browser and per
device: switching from the Samsung app to Chrome starts with none of them. A short
allowlist (`shared/synced-preferences.ts`) is mirrored per user in the database instead,
so those follow you: the server's copy wins when a browser loads, and after that the most
recent edit wins. Synced today: theme and font, favourite models, and each
provider's tool permissions. Deliberately not synced, from the same appearance settings:
chat reading size and line spacing.

**The rule:** decide which list a new preference belongs on. It syncs if it describes what
you want CLIde to be like; it stays local if it describes this device — window sizes, the
open tab, which model this phone last used.

**What breaks:** a preference you spent time on silently resets on a new browser. Syncing a per-device one is the opposite
failure and just as annoying: your phone's text size follows you onto the desktop. Tool
permissions are the case where the split is more than annoying — a device that never
received them asks about work the other one was told to allow.

---

## 17. Loading older messages follows a bookmark

New replies can arrive while you read older messages. A count from the newest reply
moves whenever that happens; a bookmark tied to the conversation keeps your place.

**The rule:** older pages follow the server's bookmark. A refresh keeps the oldest
loaded message when history only grows. A rewind or replacement starts a fresh
window, and a cancelled request cannot put abandoned messages back.

**What breaks:** messages repeat, disappear between pages, or jump back into view
after a rewind. Hidden tool records still count toward paging even though they do
not each become a visible bubble.

## 18. Updating a CLI does not require updating CLIde's copy

**The assumption:** the installed Claude or Codex launcher owns which version runs.

**The rule:** CLIde follows that launcher, automatically checks changed Codex
versions, and finishes active work before replacing its running process. New
Session offers an Update action; checking for an update never installs one.

**What breaks:** a private bundled version misses the fixes you installed, while
switching a running process can interrupt work. An incompatible update must say
so rather than silently choosing an older copy. [Decision](../decisions/0061-follow-installed-provider-clis.md).

## When to stop and ask

You do not need to understand a diff to catch these. If a proposed change would:

- pass a provider's own id to something that runs a session (1);
- branch on a provider's name in shared code (2);
- feed a transcript value into a live command without checking it (3);
- delete a database row for a session whose file is still on disk (4);
- change Claude token counting in fewer than three places (5);
- reach the backend but end with "just refresh" (6);
- ask you to verify a branch's work on 3001 (7);
- touch auth, schema, or migrations without a backup first (8);
- turn a compact control into a 44px control solely because it is used by touch (10);
- react to a usage limit by reading its sentence, or wait on a reset's predicted time (13);
- add another card to the strip above the composer for something not waiting on you (14);
- open something full-screen over the chat without locking the page, or put the phone chat back in a scrolling box (15);
- add a preference to the synced allowlist that really describes one device (16);

— then say so. Being able to name the rule is enough; you don't have to be able to prove
the violation. Asking is cheap, and every one of these is expensive to find later.

## 15. Auto-Continue is a session setting; its waiting message is one action

Settings supplies the message and the preference for new chats. Each existing chat
keeps its own Auto-Continue mode in the header menu.

**The rule:** the limit notice offers enabling only when the mode is off and no
reset message is waiting. The waiting bubble says what will be sent. Canceling
that message skips one continuation; turning the session mode off also stops
future automatic continuations.

**What breaks:** repeating the setting beside its queued message makes canceling
one send and disabling the whole mode look like the same action.
