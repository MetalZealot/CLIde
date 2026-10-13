import type { LLMProvider, Project } from '../../../types/app';
import type { ProviderAuthStatus } from '../../provider-auth/types';

export type AgentProvider = LLMProvider;
export type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/** A project with the legacy `name` (its projectId) that older settings screens key on. */
export type SettingsProject = Project & { name: string };

export type AuthStatus = ProviderAuthStatus;

export type ClaudePermissionsState = {
  allowedTools: string[];
  disallowedTools: string[];
};

export type NotificationPreferencesState = {
  channels: {
    inApp: boolean;
    webPush: boolean;
    sound: boolean;
  };
  events: {
    actionRequired: boolean;
    stop: boolean;
    error: boolean;
    usageReset: Partial<Record<LLMProvider, boolean>>;
  };
};

export type CursorPermissionsState = {
  allowedCommands: string[];
  disallowedCommands: string[];
  skipPermissions: boolean;
};

export type CodeEditorSettingsState = {
  wordWrap: boolean;
  showMinimap: boolean;
  lineNumbers: boolean;
  fontSize: string;
};

export type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: SettingsProject[];
  initialTab?: string;
  /** Opens the Usage page; the caller also closes whatever hosts Settings. */
  onOpenUsage: () => void;
};
