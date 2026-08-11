import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';

export type ProjectSortOrder = 'name' | 'date';
export type SidebarSearchMode = 'projects' | 'conversations' | 'archived';

/** Order of the sessions under one repository row. `recent` is the default. */
export type SessionSortKey = 'recent' | 'oldest' | 'title' | 'worktree';

/**
 * How one repository row presents its sessions.
 *
 * Held per row and only in memory, so a view survives navigating away and back
 * but never outlives the tab — a sort you forgot you set is worse than one you
 * have to set again. Sorting and filtering by model are deliberately absent:
 * the model pick lives in the database but never reaches the session list, and
 * almost no row carries one yet (see `docs/TODO.md`).
 */
export type RepositoryViewOptions = {
  sort: SessionSortKey;
  /** Checkouts to keep, by `projectId`. Null shows every one of them. */
  worktreeProjectIds: string[] | null;
};

/**
 * One row in the sidebar's project list (ADR 0016).
 *
 * The list is deliberately two levels deep — repository, then session — which
 * is the shape every reference client in `docs/ui ref/` converged on. So a
 * repository with several registered checkouts is *one* row whose sessions are
 * merged across those checkouts and labelled with the branch each came from,
 * not a third tier of checkout rows. A single-checkout repository renders
 * exactly as a project row did before grouping existed.
 */
export type RepositoryEntry = {
  /**
   * React key and expansion key. Derived only from the project, never from the
   * current filter, so searching cannot change which row a project belongs to.
   */
  key: string;
  /** Null for a directory that is not a git checkout. */
  repositoryId: string | null;
  /** Row label: the repository's name, else the project's display name. */
  displayName: string;
  /** Target of repository-scoped actions; the main checkout when registered. */
  leadCheckout: Project;
  /** Every registered checkout, lead first. Length 1 in the common case. */
  checkouts: Project[];
};

export type CreateWorktreeOptions = {
  /** Any registered checkout of the repository; git resolves the rest. */
  projectId: string;
  /** Branch to create along with the tree. */
  branch: string;
  /** Absolute destination. Derived beside the repository when omitted. */
  worktreePath?: string | null;
  /** Commit-ish the branch starts from. The current HEAD when omitted. */
  baseRef?: string | null;
};

/**
 * `git worktree add` and CLIde's registration of the result are two steps, and
 * only the first is undoable by the user. A rejected promise means neither
 * happened; `registrationError` means the tree is on disk and unregistered.
 */
export type CreateWorktreeOutcome = {
  worktreePath: string;
  project: Project | null;
  registrationError: string | null;
};

/** A session paired with the checkout it actually belongs to. */
export type CheckoutSession = {
  session: SessionWithProvider;
  checkout: Project;
  /**
   * Branch shown beneath the session title. Null when the row needs no
   * disambiguation, so an ordinary single-checkout project stays uncluttered.
   */
  branchLabel: string | null;
};

/**
 * A pinned session as the Pinned section draws it: it has left its repository's
 * row, so it has to name the repository it came from itself.
 */
export type PinnedSession = CheckoutSession & {
  repositoryName: string;
};

export type ActivityState = 'blocked' | 'unread' | 'running';

/** A transiently active session, labelled because Activity is a flat section. */
export type ActivitySession = CheckoutSession & {
  repositoryName: string;
  activityState: ActivityState;
};

export type ActivitySummary = Record<ActivityState, number>;

export type ArchivedProjectListItem = Project & { isArchived: true };

export type SessionWithProvider = ProjectSession & {
  __provider: LLMProvider;
};

export type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

export type DeleteProjectConfirmation = {
  /**
   * Every worktree the action covers. A sidebar row is a repository, so its own
   * delete covers all of them; the worktree manager confirms one at a time.
   */
  projects: Project[];
  /** What the confirmation names — the row's label, or one worktree's. */
  displayName: string;
  sessionCount: number;
};

// Delete confirmation payload used by sidebar UX. `projectId`/`provider` are
// kept for wiring compatibility, while API deletion now keys only by sessionId.
export type SessionDeleteConfirmation = {
  projectId: string | null;
  sessionId: string;
  sessionTitle: string;
  provider: LLMProvider;
  isArchived: boolean;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  /** Opens the neutral launcher without preselecting a project. */
  onOpenNewSession: () => void;
  onNewSession: (project: Project) => void;
  onCreateWorktree: (options: CreateWorktreeOptions) => Promise<CreateWorktreeOutcome>;
  /**
   * Registers a checkout the projects API discovered on disk, resolving to the
   * project row it now has. Discovered checkouts carry a synthetic id, so this
   * is what every other project-scoped action has to wait for.
   */
  onAdoptCheckout?: (checkoutPath: string) => Promise<Project | null>;
  onSessionDelete?: (sessionId: string) => void;
  // Optimistic in-place patch of a session's starred flag (see useProjectsState).
  onSessionStarPatch?: (sessionId: string, isStarred: boolean) => void;
  onLoadMoreSessions?: (projectId: string) => Promise<void> | void;
  // `projectId` is the DB identifier; the sidebar hands it back to the parent
  // when the delete flow completes.
  onProjectDelete?: (projectId: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab?: string;
  onCloseSettings: () => void;
  isMobile: boolean;
  /** Closes the mobile drawer; desktop collapse uses the persisted preference. */
  onCloseSidebar?: () => void;
};

export type SessionViewModel = {
  isActive: boolean;
  sessionName: string;
  sessionTime: string;
  messageCount: number;
};

export type MCPServerStatus = {
  hasMCPServer?: boolean;
  isConfigured?: boolean;
} | null;

// Retained as `name` for backwards compatibility with existing settings
// consumers; the value is populated from `projectId` by normalizeProjectForSettings.
export type SettingsProject = {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
};
