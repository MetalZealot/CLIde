# Threads with no project

- Status: not started
- Next: Phase 0 — prove each provider runs and resumes in an empty, non-git folder
- Context: [provider capability map](../maps/clide-provider-capability-map.md),
  ADR 0064 (the picker's mode is the only bypass)

A thread can start without choosing a project. It runs in a fresh, empty
folder of its own, under one scratch root beside CLIde's database, named by its
`session_id`. A new user can log in and send a message before adding any project.
The Codex app, Claude desktop's Code tab, and T3 Code all ship this same design.

## What the code assumes today

- Every session row's `project_path` is a foreign key into `projects`, and
  `createSession` / `createAppSession` create that project row on first sight.
  If nothing changes, every scratch thread would show up as its own project.
- Providers address a conversation by its working folder: Claude stores
  transcripts by cwd, so the folder must stay the same for resume to work. A
  shared folder for every thread would also mix their files together.
- The New Session launcher needs a selected project before it can send.

So each thread keeps a real per-thread `project_path`, and **the scratch root
classifies it**: a project row whose path is under the root is never listed as
a project, and its sessions appear in one "No project" group. Classification is
by path, so sessions the watcher finds on disk land in the same group as ones
CLIde created.

## Phases

- [ ] 0. Each of Claude, Codex, Cursor and OpenCode, started in an empty non-git
  folder under the root: replies, survives a server restart, and resumes.
  Record any trust or git prompt. Codex already passes `skipGitRepoCheck`, and
  the Cursor adapter already detects a workspace-trust prompt. A provider that
  fails gets a capability flag and is left out of No project, not worked around.
- [ ] 1. Server: create the scratch root and a per-thread folder when a session
  starts without a project; hide projects under the root from every project
  list; the fetch service returns those sessions as their own group, with
  `isStarred` serialized in both the fetch and watcher paths. Write the ADR in
  the same batch, because hidden project rows look like a bug. Add tests to
  the existing project-management and sessions test files.
- [ ] 2. Sidebar: agree the group's look with Grayson first, then build it.
  Rename, star, archive and delete work as they do on any session;
  `compareSessionsStarredFirst` applies. Update the sidebar map.
- [ ] 3. Launcher: "No project" is the first entry in the project picker, and
  is pre-selected when the user has no projects. It has no worktree menu.
  The empty-sidebar "no projects" state points at it instead of only at
  adding a project.
- [ ] 4. Workspace tabs on a no-project thread: Files shows the thread's own
  folder; Source Control shows its ordinary not-a-repository state; nothing
  offers project-only actions. Check on the phone; add the scratch-root rule
  to ARCHITECTURE.md.

## Done when

- On a branch-test slot with zero projects, a fresh login can type and send
  without adding a project.
- Each provider that passed Phase 0 runs a no-project thread that survives a
  restart, and that thread appears once under No project, never as a project.
- A thread's folder and the files the agent wrote stay after the thread ends,
  and after a restart.

## Not doing

- Adding the home folder as a project automatically. Users who want it add it
  like any other project.
- Removing a thread's folder when the thread is deleted, or any other cleanup.
  Files the agent wrote are kept until a cleanup is designed.
- Moving a no-project thread into a project.
- A separate permission default for no-project threads. The picker's mode
  applies, as everywhere else (ADR 0064).
- A setting for where the scratch root lives.
