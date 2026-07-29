import { AlertTriangle, ExternalLink, Github } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTasksSettings } from '../../../../contexts/TasksSettingsContext';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsToggle } from '../primitives';

const TASK_MASTER_REPO_URL = 'https://github.com/eyaltoledano/claude-task-master';

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  setTasksEnabled: (enabled: boolean) => void;
  isTaskMasterInstalled: boolean | null;
  isCheckingInstallation: boolean;
};

/**
 * Task Master install detection plus the single enable toggle. The screen title
 * comes from the registry via the header/rail, so the old tab's `mainTabs.tasks`
 * section heading is gone rather than repeated inside the screen.
 */
export default function ExtensionsTasksScreen() {
  const { t } = useTranslation('settings');
  const {
    tasksEnabled,
    setTasksEnabled,
    isTaskMasterInstalled,
    isCheckingInstallation,
  } = useTasksSettings() as TasksSettingsContextValue;

  if (isCheckingInstallation) {
    return (
      <SettingsScreen>
        <SettingsGroup>
          <div className="flex items-center gap-3 p-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">{t('tasks.checking')}</span>
          </div>
        </SettingsGroup>
      </SettingsScreen>
    );
  }

  if (!isTaskMasterInstalled) {
    return (
      <SettingsScreen>
        <SettingsGroup tone="warning">
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="text-sm font-medium text-foreground">
                {t('tasks.notInstalled.title')}
              </div>
              <p className="text-sm text-muted-foreground">{t('tasks.notInstalled.description')}</p>

              <div className="rounded-lg bg-background/60 p-3 font-mono text-sm text-foreground">
                <code>{t('tasks.notInstalled.installCommand')}</code>
              </div>

              <a
                href={TASK_MASTER_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                <Github className="h-4 w-4" />
                {t('tasks.notInstalled.viewOnGitHub')}
                <ExternalLink className="h-3 w-3" />
              </a>

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {t('tasks.notInstalled.afterInstallation')}
                </p>
                <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
                  <li>{t('tasks.notInstalled.steps.restart')}</li>
                  <li>{t('tasks.notInstalled.steps.autoAvailable')}</li>
                  <li>{t('tasks.notInstalled.steps.initCommand')}</li>
                </ol>
              </div>
            </div>
          </div>
        </SettingsGroup>
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen>
      <SettingsGroup>
        <SettingsRow
          label={t('tasks.settings.enableLabel')}
          description={t('tasks.settings.enableDescription')}
        >
          <SettingsToggle
            checked={tasksEnabled}
            onChange={setTasksEnabled}
            ariaLabel={t('tasks.settings.enableLabel')}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsScreen>
  );
}
