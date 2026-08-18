import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';

export type ProjectSortOrder = 'name' | 'date';
export type SidebarSearchMode = 'projects' | 'conversations' | 'archived';
export type SidebarBrowseMode = 'projects' | 'sessions';

/** Ascending is oldest-first for dates and A–Z for text fields. */
export type SessionSortDirection = 'asc' | 'desc';

export type ProjectViewOptions = {
  sort: ProjectSortOrder;
  direction: SessionSortDirection;
};

export type BrowseSessionSortKey = 'date' | 'title' | 'project';

/** How the flat, cross-project Sessions view is presented. */
export type BrowseSessionViewOptions = {
  sort: BrowseSessionSortKey;
  direction: SessionSortDirection;
};

/** The visible list whose session rows batch mode replaces with checkboxes. */
export type SessionSelectionScope =
  | { kind: 'repository'; entryKey: string }
  | { kind: 'sessions' };

/** Field the sessions under one repository row are ordered by. */
export type SessionSortKey = 'date' | 'title' | 'worktree';

/**
 * How one repository row presents its sessions.
 *
 * Per row and in memory only, so a view survives navigating away and back but
 * never outlives the tab — a sort you forgot you set is worse than one you have
 * to set again. Sorting and filtering by model are deliberately absent: the
 * model pick lives in the database but never reaches the session list.
 */
export type RepositoryViewOptions = {
  sort: SessionSortKey;
  direction: SessionSortDirection;
  /** Checkouts to keep, by `projectId`. Null shows every one of them. */
  worktreeProjectIds: string[] | null;
};

/**
 * One row in the sidebar's project list (ADR 0016).
 *
 * The list is two levels deep — repository, then session. A repository with
 * several registered checkouts is *one* row whose sessions are merged across
 * them and labelled with each branch, not a third tier of checkout rows. A
 * single-checkout repository renders exactly as a project row did before
 * grouping existed.
 */
export type RepositoryEntry = {
  /**
   * React key and expansion key. Derived only from the project, never the
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
   * Folder the session runs in, shown beneath its title. Null when the row needs
   * no disambiguation, so an ordinary single-checkout project stays uncluttered.
   */
  checkoutLabel: string | null;
};

/** A session in the flat Sessions view, labelled with its repository. */
export type BrowseSession = CheckoutSession & {
  repositoryName: string;
  /** The repository row's highlight, inherited even when this is a worktree session. */
  repositoryAccentColor: Project['accentColor'];
};

export type ActivityState = 'blocked' | 'unread' | 'running';

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
   * Every worktree the action covers. A sidebar row is a repository, so its
   * delete covers all of them; the worktree manager confirms one at a time.
   */
  projects: Project[];
  /** What the confirmation names — the row's label, or one worktree's. */
  displayName: string;
  sessionCount: number;
  /** False when Delete was chosen explicitly and Archive would be a duplicate path. */
  allowArchive?: boolean;
  /** True when the targets are every worktree in a repository, not a selection. */
  coversRepository?: boolean;
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
   * Registers a checkout the projects API discovered on disk, resolving to its
   * new project row. Discovered checkouts carry a synthetic id, so every other
   * project-scoped action waits for this.
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
  onShowSettings: (screenId?: string) => void;
  onShowUsage: () => void;
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
