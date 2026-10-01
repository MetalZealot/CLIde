import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import type { SettingsProject } from '../../types/types';
import {
  NO_PROJECT,
  cascadeUrl,
  initialConfigurationProject,
  projectPathOf,
  rememberConfigurationProject,
} from '../../utils/claudeConfiguration';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsSelect } from '../primitives';

type CascadeSource = 'user' | 'project' | 'local' | 'managed' | 'flag';
type CascadeTier = 'exposed' | 'adapt' | 'display' | 'terminal' | 'out-of-scope' | 'unclassified';

type CascadeEntry = {
  key: string;
  tier: CascadeTier;
  value: unknown;
  source: CascadeSource;
  path?: string;
  alsoSetIn: CascadeSource[];
  redacted?: true;
};

type CascadeApiResponse = { success?: boolean; data?: { entries: CascadeEntry[] } };

const TIER_ORDER: CascadeTier[] = ['exposed', 'adapt', 'display', 'unclassified', 'terminal', 'out-of-scope'];

const isScalar = (value: unknown): boolean => value === null || typeof value !== 'object';

function EntryRow({ entry }: { entry: CascadeEntry }) {
  const { t } = useTranslation('settings');
  const sourceLabel = (source: CascadeSource) => t(`configuration.sources.${source}`);

  let summary: string;
  if (entry.redacted) {
    summary = t('configuration.hiddenValues', { names: (entry.value as string[]).join(', ') });
  } else if (isScalar(entry.value)) {
    summary = String(entry.value);
  } else {
    const count = Array.isArray(entry.value) ? entry.value.length : Object.keys(entry.value as object).length;
    summary = t('configuration.items', { count });
  }

  const expandable = !entry.redacted && !isScalar(entry.value);

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="break-all font-mono text-sm text-foreground">{entry.key}</div>
          {expandable ? (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-sm text-muted-foreground">{summary}</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs text-foreground">
                {JSON.stringify(entry.value, null, 2)}
              </pre>
            </details>
          ) : (
            <div className="mt-0.5 break-all text-sm text-muted-foreground">{summary}</div>
          )}
          {entry.alsoSetIn.length > 0 && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('configuration.alsoSetIn', { sources: entry.alsoSetIn.map(sourceLabel).join(', ') })}
            </div>
          )}
        </div>
        <Badge
          variant={entry.source === 'managed' ? 'destructive' : 'secondary'}
          className="flex-shrink-0"
          title={entry.path}
        >
          {sourceLabel(entry.source)}
        </Badge>
      </div>
    </div>
  );
}

/**
 * Agents › Claude › Configuration.
 *
 * Read-only view of every key Claude Code's settings files set, grouped by what
 * CLIde does with it. Project and local files depend on the project, so the
 * screen resolves against one chosen project at a time.
 */
export default function AgentConfigurationScreen({ projects }: { projects: SettingsProject[] }) {
  const { t } = useTranslation('settings');
  const [workspacePath, setWorkspacePath] = useState(() => initialConfigurationProject(projects));
  const [entries, setEntries] = useState<CascadeEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    authenticatedFetch(cascadeUrl(workspacePath))
      .then((response) => response.json() as Promise<CascadeApiResponse>)
      .then((body) => {
        if (cancelled) return;
        setEntries(body.success ? body.data?.entries ?? [] : null);
        setError(!body.success);
      })
      .catch((loadError) => {
        console.error('Error resolving Claude settings:', loadError);
        if (!cancelled) setError(true);
      });
    return () => { cancelled = true; };
  }, [workspacePath]);

  const projectOptions = [
    ...projects
      .filter((project) => projectPathOf(project))
      .map((project) => ({ value: projectPathOf(project), label: project.displayName || project.name })),
    { value: NO_PROJECT, label: t('configuration.noProject') },
  ];

  const chooseProject = (next: string) => {
    rememberConfigurationProject(next);
    setWorkspacePath(next);
  };

  return (
    <SettingsScreen>
      <SettingsGroup description={t('configuration.description')}>
        <SettingsRow stacked label={t('configuration.project')}>
          <SettingsSelect
            value={workspacePath}
            options={projectOptions}
            onChange={chooseProject}
            ariaLabel={t('configuration.project')}
          />
        </SettingsRow>
      </SettingsGroup>

      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{t('configuration.loadError')}</p>
      )}

      {entries && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('configuration.empty')}</p>
      )}

      {entries && TIER_ORDER.map((tier) => {
        const rows = entries.filter((entry) => entry.tier === tier);
        if (rows.length === 0) return null;
        return (
          <SettingsGroup
            key={tier}
            divided
            title={t(`configuration.tiers.${tier}.title`)}
            description={t(`configuration.tiers.${tier}.description`)}
          >
            {rows.map((entry) => <EntryRow key={entry.key} entry={entry} />)}
          </SettingsGroup>
        );
      })}
    </SettingsScreen>
  );
}
