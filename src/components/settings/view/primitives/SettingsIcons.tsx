import {
  Bell,
  Brain,
  CircleUser,
  Code2,
  FileCode2,
  GitBranch,
  Info,
  KeyRound,
  ListChecks,
  MessageSquare,
  Mic,
  MonitorPlay,
  Palette,
  Puzzle,
  Server,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { LLMProvider } from '../../../../types/app';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AgentProviderId, SettingsIconName } from '../../registry/registry';

/**
 * Provider rows use the real product logo rather than a generic bot glyph — it
 * is the fastest way to find your provider in the root list. Wrapped so the
 * registry's icon contract stays "a component taking a className".
 */
const providerLogo = (provider: AgentProviderId): ComponentType<{ className?: string }> => {
  // The registry restates the provider union to stay import-free; this widening
  // is where the two definitions are checked against each other.
  const providerId: LLMProvider = provider;

  function ProviderLogoIcon({ className }: { className?: string }) {
    return <SessionProviderLogo provider={providerId} className={className} />;
  }

  return ProviderLogoIcon;
};

/**
 * Resolves the registry's icon names to components. The registry stays pure
 * data — no React imports — so it can be unit-tested without a renderer; this
 * map is the one place the two meet, and `Record` makes it exhaustive, so
 * adding an icon name to the registry fails the typecheck until it is mapped.
 */
export const SETTINGS_ICONS: Record<SettingsIconName, ComponentType<{ className?: string }>> = {
  appearance: Palette,
  codeEditor: Code2,
  chat: MessageSquare,
  voice: Mic,
  notifications: Bell,
  git: GitBranch,
  plugins: Puzzle,
  browser: MonitorPlay,
  tasks: ListChecks,
  credentials: KeyRound,
  about: Info,
  account: CircleUser,
  providerClaude: providerLogo('claude'),
  providerCursor: providerLogo('cursor'),
  providerCodex: providerLogo('codex'),
  providerOpenCode: providerLogo('opencode'),
  permissions: ShieldCheck,
  mcp: Server,
  skills: FileCode2,
  defaultModel: Brain,
};
