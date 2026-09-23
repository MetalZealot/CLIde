import type { LLMProvider } from '../../types/app';

/** Mirrors `ProviderPlugin` in the server's shared types. */
export type ToolsPlugin = {
  id: string;
  name: string;
  description: string;
  marketplace: string;
  marketplaceLabel: string;
  enabled: boolean;
  version?: string;
  skills: Array<{ name: string; command: string; description: string }>;
  connectors: string[];
};

export type ToolsConnectorState =
  | 'connected'
  | 'needs-auth'
  | 'cannot-auth'
  | 'failed'
  | 'disabled'
  | 'not-configured'
  | 'unknown';

/** Mirrors `ProviderConnector` in the server's shared types. */
export type ToolsConnector = {
  id: string;
  name: string;
  origin: 'plugin' | 'account' | 'user';
  pluginName?: string;
  state: ToolsConnectorState;
  detail?: string;
};

export type ToolsProvider = LLMProvider;
