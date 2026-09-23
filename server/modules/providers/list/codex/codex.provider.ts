import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';
import { CodexProviderModels } from '@/modules/providers/list/codex/codex-models.provider.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { CodexMcpProvider } from '@/modules/providers/list/codex/codex-mcp.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { CodexSkillsProvider } from '@/modules/providers/list/codex/codex-skills.provider.js';
import { CodexToolsProvider } from '@/modules/providers/list/codex/codex-tools.provider.js';
import { CodexProviderUsage } from '@/modules/providers/list/codex/codex-usage.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
  IProviderTools,
  IProviderUsage,
} from '@/shared/interfaces.js';

export class CodexProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = codexRuntime;
  readonly models: IProviderModels = new CodexProviderModels();
  readonly mcp = new CodexMcpProvider();
  readonly auth: IProviderAuth = new CodexProviderAuth();
  readonly skills: IProviderSkills = new CodexSkillsProvider();
  readonly sessions: IProviderSessions = new CodexSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new CodexSessionSynchronizer();
  readonly usage: IProviderUsage = new CodexProviderUsage();
  readonly tools: IProviderTools = new CodexToolsProvider();

  constructor() {
    super('codex');
  }
}
