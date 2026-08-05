import type { LoadingProgress, Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';

export type ProjectSortOrder = 'name' | 'date';
export type SidebarSearchMode = 'projects' | 'conversations' | 'running' | 'archived';

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
  project: Project;
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
  onNewSession: (project: Project) => void;
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
