import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  BookOpen,
  ChevronRight,
  Loader2,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../../lib/utils';
import { formatUpdatedAgo } from '../../provider-usage/format';
import { Button, Dialog, DialogContent, DialogTitle, Input } from '../../../shared/view/ui';
import { useClaudePluginUpdates } from '../../skills/hooks/useClaudePluginUpdates';
import { useProviderSkills } from '../../skills/hooks/useProviderSkills';
import AddSkillDialog from '../../skills/view/AddSkillDialog';
import type { ProviderSkill, SkillsScope, SkillsTarget } from '../../skills/types';
import { useProviderTools } from '../hooks/useProviderTools';
import type { ToolsConnector, ToolsConnectorState, ToolsPlugin, ToolsProvider } from '../types';

type Tab = 'all' | 'skills' | 'plugins' | 'mcp';
type Tone = 'good' | 'warn' | 'bad' | 'muted';

type ToolRow = {
  key: string;
  kind: 'skill' | 'plugin' | 'connector';
  title: string;
  subtitle: string;
  status: string;
  tone?: Tone;
  group?: string;
  skill?: ProviderSkill;
  plugin?: ToolsPlugin;
  connector?: ToolsConnector;
};

type ProviderToolsProps = {
  provider: ToolsProvider;
  target: SkillsTarget;
  showSkills: boolean;
  onOpenMcpEditor: () => void;
};

const PROVIDER_CLI: Partial<Record<ToolsProvider, string>> = { claude: 'claude', codex: 'codex' };

const ACCOUNT_LABEL: Partial<Record<ToolsProvider, string>> = {
  claude: 'claude.ai account',
  codex: 'ChatGPT account',
};

const SCOPE_SOURCE: Record<SkillsScope, string> = {
  user: 'Personal',
  synced: 'Synced from claude.ai',
  plugin: 'Plugin',
  project: 'This project',
  repo: 'This repository',
  admin: 'Admin',
  system: 'Built in',
};

const CONNECTOR_STATUS: Record<ToolsConnectorState, { label: string; tone: Tone; rank: number }> = {
  'needs-auth': { label: 'Needs sign-in', tone: 'warn', rank: 0 },
  'cannot-auth': { label: "Can't sign in here", tone: 'bad', rank: 1 },
  failed: { label: "Can't connect", tone: 'bad', rank: 2 },
  connected: { label: 'Connected', tone: 'good', rank: 3 },
  unknown: { label: 'Status unknown', tone: 'muted', rank: 4 },
  'not-configured': { label: 'Not set up', tone: 'muted', rank: 5 },
  disabled: { label: 'Off for this project', tone: 'muted', rank: 6 },
};

const TONE_DOT: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  muted: 'bg-muted-foreground/50',
};

const TAB_LABELS: Record<Tab, string> = { all: 'All', skills: 'Skills', plugins: 'Plugins', mcp: 'MCP' };
const SECTION_LABELS: Record<ToolRow['kind'], string> = { plugin: 'Plugins', skill: 'Skills', connector: 'MCP' };
const KIND_ICONS: Record<ToolRow['kind'], LucideIcon> = { skill: BookOpen, plugin: Puzzle, connector: Plug };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const connectorSource = (connector: ToolsConnector, provider: ToolsProvider): string => {
  if (connector.origin === 'plugin') return `From ${connector.pluginName ?? 'a plugin'}`;
  if (connector.origin === 'account') return `From your ${ACCOUNT_LABEL[provider] ?? 'account'}`;
  return 'Your server';
};

/** What to do about a connector's state, in one sentence, or null when nothing is needed. */
const connectorAdvice = (connector: ToolsConnector, provider: ToolsProvider): string | null => {
  const cli = PROVIDER_CLI[provider];
  if (connector.state === 'needs-auth') {
    if (provider === 'codex') return `Sign in from the Shell tab: run codex mcp login ${connector.name}.`;
    if (cli) return `Sign in from the Shell tab: run ${cli}, then /mcp, and choose this server.`;
  }
  if (connector.state === 'cannot-auth') {
    return 'This server does not let Claude Code register for sign-in, so it cannot be signed into from here.';
  }
  if (connector.state === 'disabled' && provider === 'claude') {
    return 'Turned off for this project. Turn it back on from the Shell tab: run claude, then /mcp.';
  }
  if (connector.state === 'not-configured') {
    return 'The plugin ships this server without an address, so there is nothing to connect to yet.';
  }
  if (connector.origin === 'account') {
    return provider === 'codex'
      ? 'Managed in your ChatGPT apps settings.'
      : 'Managed in your claude.ai connector settings.';
  }
  return null;
};

function StatusLine({ status, tone }: { status: string; tone?: Tone }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {tone && <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />}
      <span className="truncate">{status}</span>
    </p>
  );
}

function Row({ row, onOpen }: { row: ToolRow; onOpen: (row: ToolRow) => void }) {
  const Icon = KIND_ICONS[row.kind];
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="flex min-h-11 w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-medium text-foreground">{row.title}</span>
        {row.subtitle && <span className="block truncate text-xs text-muted-foreground">{row.subtitle}</span>}
        <StatusLine status={row.status} tone={row.tone} />
      </span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

function Section({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {count !== undefined && <span className="ml-1.5 font-normal normal-case tracking-normal opacity-70">{count}</span>}
      </p>
      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card/50">
        {children}
      </div>
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">{children}</p>;
}

function DetailList({ title, items }: { title: string; items: Array<{ key: string; label: string; detail?: string; tone?: Tone }> }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title} <span className="font-normal normal-case tracking-normal opacity-70">{items.length}</span>
      </p>
      <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
        {items.map((item) => (
          <li key={item.key} className="min-w-0 px-3 py-2">
            <p className="truncate text-sm text-foreground">{item.label}</p>
            {item.detail && <StatusLine status={item.detail} tone={item.tone} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailDialog({
  row,
  provider,
  connectors,
  onClose,
}: {
  row: ToolRow | null;
  provider: ToolsProvider;
  connectors: ToolsConnector[];
  onClose: () => void;
}) {
  const plugin = row?.plugin;
  const connector = row?.connector;
  const skill = row?.skill;
  const advice = connector ? connectorAdvice(connector, provider) : null;

  const pluginConnectors = plugin
    ? plugin.connectors.map((name) => {
      const match = connectors.find((candidate) => (
        candidate.name === name && (candidate.pluginName === plugin.name || candidate.origin === 'account')
      ));
      const status = match ? CONNECTOR_STATUS[match.state] : undefined;
      return { key: name, label: name, detail: status?.label, tone: status?.tone };
    })
    : [];

  return (
    <Dialog open={row !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        wrapperClassName="z-[10000]"
        className="flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg flex-col overflow-hidden p-0"
      >
        <DialogTitle>{row?.title ?? ''}</DialogTitle>
        <div className="flex shrink-0 items-start gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="break-words text-base font-medium text-foreground">{row?.title}</p>
            {row && <StatusLine status={row.status} tone={row.tone} />}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 p-0 text-muted-foreground"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          {(skill?.description || plugin?.description) && (
            <p className="leading-relaxed text-muted-foreground">{skill?.description || plugin?.description}</p>
          )}

          {plugin && (
            <>
              <p className="text-muted-foreground">
                {plugin.marketplaceLabel}
                {plugin.version ? ` · version ${plugin.version}` : ''}
              </p>
              <DetailList
                title="Skills"
                items={plugin.skills.map((item) => ({ key: item.command, label: item.command, detail: item.description }))}
              />
              <DetailList title="Connectors" items={pluginConnectors} />
            </>
          )}

          {connector && (
            <>
              <p className="text-muted-foreground">{connectorSource(connector, provider)}</p>
              {advice && <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-foreground">{advice}</p>}
              {connector.detail && connector.state !== 'connected' && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reported by {PROVIDER_CLI[provider] ?? provider}</p>
                  <code className="block whitespace-normal break-words text-xs text-foreground">{connector.detail}</code>
                </div>
              )}
            </>
          )}

          {skill && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</p>
              <code className="block whitespace-normal break-all text-xs text-foreground">{skill.sourcePath || row?.subtitle}</code>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Skills, plugins and MCP connectors for one provider and checkout, on one
 * page. Read-only apart from adding a global skill and the link to the MCP
 * server editor; plugins and connectors are shown as the provider reports them.
 */
export default function ProviderTools({ provider, target, showSkills, onOpenMcpEditor }: ProviderToolsProps) {
  const { skills, isLoading: isLoadingSkills, loadError: skillsError, addSkills, refreshSkills } = useProviderSkills({
    selectedProvider: provider,
    target,
  });
  const { plugins, connectors, refresh } = useProviderTools(provider, target);
  const tracksPlugins = provider === 'claude';
  const {
    status: pluginUpdateStatus,
    isUpdating: isUpdatingPlugins,
    error: pluginUpdateError,
    updateNow: updatePlugins,
  } = useClaudePluginUpdates(tracksPlugins, () => refresh());
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [openRow, setOpenRow] = useState<ToolRow | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const skillRows = useMemo<ToolRow[]>(() => {
    if (!showSkills) return [];
    // A chosen checkout's own skills are why it was chosen, so they lead.
    const isLocal = (skill: ProviderSkill) => skill.scope === 'project' || skill.scope === 'repo';
    const ordered = [...skills.filter(isLocal), ...skills.filter((skill) => !isLocal(skill))];
    const rows: ToolRow[] = ordered.map((skill) => ({
      key: `skill:${skill.command}:${skill.sourcePath}`,
      kind: 'skill',
      title: skill.command,
      subtitle: skill.description,
      status: skill.pluginName ? `From ${skill.pluginName}` : SCOPE_SOURCE[skill.scope],
      skill,
    }));
    // Codex lists plugin skills only on the plugin; Claude's already arrive with the skills.
    const seen = new Set(skills.map((skill) => skill.command));
    for (const plugin of plugins.items.filter((candidate) => candidate.enabled)) {
      for (const item of plugin.skills.filter((candidate) => !seen.has(candidate.command))) {
        seen.add(item.command);
        rows.push({
          key: `skill:${item.command}`,
          kind: 'skill',
          title: item.command,
          subtitle: item.description,
          status: `From ${plugin.name}`,
        });
      }
    }
    return rows;
  }, [plugins.items, showSkills, skills]);

  const pluginRows = useMemo<ToolRow[]>(() => (
    [...plugins.items]
      // Plugins that are on lead; ones that are off are usually leftovers.
      .sort((left, right) => (
        Number(right.enabled) - Number(left.enabled)
        || left.marketplaceLabel.localeCompare(right.marketplaceLabel)
        || left.name.localeCompare(right.name)
      ))
      .map((plugin) => ({
        key: `plugin:${plugin.id}`,
        kind: 'plugin',
        title: plugin.name,
        subtitle: plugin.description,
        status: [
          plugin.enabled ? 'On' : 'Off',
          plugin.skills.length ? plural(plugin.skills.length, 'skill') : null,
          plugin.connectors.length ? plural(plugin.connectors.length, 'connector') : null,
        ].filter(Boolean).join(' · '),
        tone: plugin.enabled ? 'good' : 'muted',
        group: plugin.marketplaceLabel,
        plugin,
      }))
  ), [plugins.items]);

  const connectorRows = useMemo<ToolRow[]>(() => (
    [...connectors.items]
      .sort((left, right) => (
        CONNECTOR_STATUS[left.state].rank - CONNECTOR_STATUS[right.state].rank || left.name.localeCompare(right.name)
      ))
      .map((connector) => ({
        key: `connector:${connector.id}`,
        kind: 'connector',
        title: connector.name,
        subtitle: connectorSource(connector, provider),
        status: CONNECTOR_STATUS[connector.state].label,
        tone: CONNECTOR_STATUS[connector.state].tone,
        connector,
      }))
  ), [connectors.items, provider]);

  const tabs = useMemo<Tab[]>(() => [
    'all',
    ...(showSkills ? ['skills' as const] : []),
    ...(plugins.supported ? ['plugins' as const] : []),
    'mcp',
  ], [plugins.supported, showSkills]);

  const matches = (row: ToolRow) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || [row.title, row.subtitle, row.status, row.group]
      .some((value) => value?.toLocaleLowerCase().includes(needle));
  };

  const visible = {
    skill: skillRows.filter(matches),
    plugin: pluginRows.filter(matches),
    connector: connectorRows.filter(matches),
  };
  const counts: Record<Tab, number> = {
    all: skillRows.length + pluginRows.length + connectorRows.length,
    skills: skillRows.length,
    plugins: pluginRows.length,
    mcp: connectorRows.length,
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const handleRefresh = () => {
    if (tracksPlugins) void updatePlugins();
    void refreshSkills({ force: true });
    refresh();
  };

  const pluginUpdatedAgo = pluginUpdateStatus?.lastUpdatedAt ? formatUpdatedAgo(pluginUpdateStatus.lastUpdatedAt) : null;
  const pluginUpdateText = isUpdatingPlugins
    ? 'Updating plugins…'
    : pluginUpdateError ?? (pluginUpdatedAgo ? `Plugins updated ${pluginUpdatedAgo}` : null);
  const isBusy = isLoadingSkills || plugins.isLoading || connectors.isLoading || isUpdatingPlugins;

  const renderRows = (rows: ToolRow[]) => rows.map((row) => <Row key={row.key} row={row} onOpen={setOpenRow} />);

  const skillsSection = (
    <Section label={SECTION_LABELS.skill} count={visible.skill.length}>
      {isLoadingSkills && skills.length === 0 && <Notice><Loader2 className="h-4 w-4 animate-spin" />Loading skills…</Notice>}
      {skillsError && <Notice>{skillsError}</Notice>}
      {!isLoadingSkills && visible.skill.length === 0 && <Notice>No skills{query ? ' match' : ' found'}.</Notice>}
      {renderRows(visible.skill)}
    </Section>
  );

  const pluginsNotice = (
    <>
      {plugins.isLoading && plugins.items.length === 0 && <Notice><Loader2 className="h-4 w-4 animate-spin" />Loading plugins…</Notice>}
      {plugins.error && <Notice>{plugins.error}</Notice>}
      {!plugins.isLoading && visible.plugin.length === 0 && <Notice>No plugins{query ? ' match' : ' installed'}.</Notice>}
    </>
  );

  const connectorsSection = (
    <Section label={SECTION_LABELS.connector} count={connectors.supported ? visible.connector.length : undefined}>
      {connectors.supported && connectors.isLoading && (
        <Notice><Loader2 className="h-4 w-4 animate-spin" />Checking each server — this takes a few seconds…</Notice>
      )}
      {connectors.error && <Notice>{connectors.error}</Notice>}
      {connectors.supported && !connectors.isLoading && visible.connector.length === 0 && (
        <Notice>No MCP servers{query ? ' match' : ''}.</Notice>
      )}
      {renderRows(visible.connector)}
      <button
        type="button"
        onClick={onOpenMcpEditor}
        className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">Add or edit your own servers</span>
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground/60" />
      </button>
    </Section>
  );

  const groupedPlugins = visible.plugin.reduce<Map<string, ToolRow[]>>((groups, row) => {
    groups.set(row.group ?? '', [...(groups.get(row.group ?? '') ?? []), row]);
    return groups;
  }, new Map());

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${counts.all} tools`}
              aria-label="Search tools"
              className="h-9 w-full pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {showSkills && (
            <Button type="button" size="sm" className="shrink-0" onClick={() => setIsAddOpen(true)}>
              <Plus className="h-4 w-4" />
              {/* A new skill always installs globally, whichever checkout is shown. */}
              {target.kind === 'workspace' ? 'Add to Global' : 'Add skill'}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            aria-label={tracksPlugins ? 'Refresh and update plugins' : 'Refresh'}
            title={tracksPlugins ? 'Refresh and update plugins' : 'Refresh'}
            className="h-9 w-9 shrink-0 px-0"
            disabled={isBusy}
          >
            <RefreshCw className={cn('h-4 w-4', isBusy && 'animate-spin')} />
          </Button>
        </div>
        {pluginUpdateText && (
          <p className={cn('text-xs', pluginUpdateError ? 'text-destructive' : 'text-muted-foreground')}>{pluginUpdateText}</p>
        )}
      </div>

      <div role="tablist" aria-label="Tool types" className="flex gap-1 overflow-x-auto border-b border-border/60">
        {tabs.map((candidate) => (
          <button
            key={candidate}
            ref={(node) => { tabRefs.current[candidate] = node; }}
            type="button"
            role="tab"
            id={`tools-tab-${candidate}`}
            aria-selected={tab === candidate}
            aria-controls="tools-tabpanel"
            tabIndex={tab === candidate ? 0 : -1}
            onClick={() => setTab(candidate)}
            onKeyDown={handleTabKey}
            className={cn(
              '-mb-px min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              tab === candidate ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[candidate]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="tools-tabpanel" aria-labelledby={`tools-tab-${tab}`} className="space-y-5">
        {tab === 'all' && (
          <>
            {plugins.supported && (
              <Section label={SECTION_LABELS.plugin} count={visible.plugin.length}>
                {pluginsNotice}
                {renderRows(visible.plugin)}
              </Section>
            )}
            {showSkills && skillsSection}
            {connectorsSection}
          </>
        )}
        {tab === 'skills' && skillsSection}
        {tab === 'plugins' && (
          groupedPlugins.size === 0
            ? <Section label={SECTION_LABELS.plugin} count={0}>{pluginsNotice}</Section>
            : [...groupedPlugins.entries()].map(([group, rows]) => (
              <Section key={group} label={group} count={rows.length}>{renderRows(rows)}</Section>
            ))
        )}
        {tab === 'mcp' && connectorsSection}
      </div>

      <DetailDialog row={openRow} provider={provider} connectors={connectors.items} onClose={() => setOpenRow(null)} />
      {showSkills && (
        <AddSkillDialog provider={provider} open={isAddOpen} onOpenChange={setIsAddOpen} addSkills={addSkills} />
      )}
    </div>
  );
}
