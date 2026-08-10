export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'opencode';

export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  effort?: {
    default?: string;
    values: {
      value: string;
      description?: string;
    }[];
  };
};

export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
};

export type ProviderModelsCacheInfo = {
  updatedAt: string;
  expiresAt: string;
  source: 'memory' | 'disk' | 'fresh';
};

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'browser' | `plugin:${string}`;

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  provider?: LLMProvider;
  // Starred conversations float to the top of their project and show a small star.
  isStarred?: boolean;
  __provider?: LLMProvider;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// After the projectName → projectId migration the backend no longer returns a
// folder-derived `name` string. Projects are now addressed everywhere by the
// DB-assigned `projectId` (primary key in the `projects` table), and the UI
// uses the same identifier for routing, state keys and API calls.
export interface Project {
  projectId: string;
  displayName: string;
  fullPath: string;
  path?: string;
  isStarred?: boolean;
  /**
   * Palette token for the sidebar highlight strip, or null/absent for none.
   * Validated against the palette on read — see `sidebar/utils/accentColors.ts`.
   */
  accentColor?: string | null;
  sessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  // ADR 0016: git-derived identity supplied by the projects API. `repositoryId`
  // is the shared git directory that every checkout of one repository resolves
  // to, and is the key the sidebar groups on. Absent for non-repository projects
  // and on the archived list, which is deliberately flat.
  repositoryId?: string | null;
  branch?: string | null;
  detachedHead?: string | null;
  [key: string]: unknown;
}

export interface LoadingProgress {
  kind?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

/**
 * One entry moved or renamed on disk. Emitted by the Files tab so other
 * surfaces holding a path — an open editor, a media preview — can rebind to
 * the new location instead of silently writing back to the old one.
 *
 * A `directory` change implies every path beneath `oldPath` moved with it.
 */
export interface FilePathChange {
  oldPath: string;
  newPath: string;
  type: 'file' | 'directory';
}
