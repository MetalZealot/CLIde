import {
  Bell,
  Bot,
  Code2,
  GitBranch,
  Info,
  KeyRound,
  ListChecks,
  Mic,
  MonitorPlay,
  Palette,
  Puzzle,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { SettingsIconName } from '../../registry/registry';

/**
 * Resolves the registry's icon names to components. The registry stays pure
 * data — no React imports — so it can be unit-tested without a renderer; this
 * map is the one place the two meet, and `Record` makes it exhaustive, so
 * adding an icon name to the registry fails the typecheck until it is mapped.
 */
export const SETTINGS_ICONS: Record<SettingsIconName, ComponentType<{ className?: string }>> = {
  agents: Bot,
  appearance: Palette,
  codeEditor: Code2,
  voice: Mic,
  notifications: Bell,
  git: GitBranch,
  plugins: Puzzle,
  browser: MonitorPlay,
  tasks: ListChecks,
  credentials: KeyRound,
  about: Info,
};
