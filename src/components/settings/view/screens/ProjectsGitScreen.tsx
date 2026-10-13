import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Project } from '../../../../types/app';
import {
  findNewSessionProjectTarget,
  readNewSessionProjectPreference,
  resolvePrimaryCheckout,
  toNewSessionProjectTarget,
  writeNewSessionProjectPreference,
  type NewSessionProjectMode,
  type NewSessionProjectPreference,
} from '../../../chat/utils/newSessionLauncher';
import { buildRepositoryEntries, isDiscoveredCheckout } from '../../../sidebar/utils/utils';
import { useGitSettings } from '../../hooks/useGitSettings';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsSelect, SettingsTextField } from '../primitives';

type ProjectsGitScreenProps = {
  projects: Project[];
};

const NO_PROJECT = '';

/** Which project the New Session launcher opens with. */
function NewSessionProjectGroup({ projects }: ProjectsGitScreenProps) {
  const { t } = useTranslation('settings');
  const [preference, setPreference] = useState(readNewSessionProjectPreference);

  const entries = useMemo(
    () => buildRepositoryEntries(projects.filter((project) => !isDiscoveredCheckout(project))),
    [projects],
  );
  const fixedProject = findNewSessionProjectTarget(projects, preference.fixed);
  const fixedKey = fixedProject ? toNewSessionProjectTarget(fixedProject).repositoryKey : NO_PROJECT;

  const update = (changes: Partial<NewSessionProjectPreference>) => {
    writeNewSessionProjectPreference(changes);
    setPreference(readNewSessionProjectPreference());
  };

  const chooseMode = (mode: NewSessionProjectMode) => {
    // Fixed starts on the last-selected project's repository rather than an empty pick.
    const seed = mode === 'fixed' && !fixedProject ? findNewSessionProjectTarget(projects, preference.last) : null;
    const seedEntry = seed ? entries.find((entry) => entry.key === toNewSessionProjectTarget(seed).repositoryKey) : null;
    update(seedEntry ? { mode, fixed: toNewSessionProjectTarget(resolvePrimaryCheckout(seedEntry)) } : { mode });
  };

  const chooseProject = (key: string) => {
    const entry = entries.find((candidate) => candidate.key === key);
    if (entry) update({ fixed: toNewSessionProjectTarget(resolvePrimaryCheckout(entry)) });
  };

  return (
    <SettingsGroup title={t('newSessionProject.title')} description={t('newSessionProject.description')} divided>
      <SettingsRow stacked label={t('newSessionProject.mode.label')}>
        <SettingsSelect
          value={preference.mode}
          options={[
            { value: 'last', label: t('newSessionProject.mode.last') },
            { value: 'fixed', label: t('newSessionProject.mode.fixed') },
            { value: 'none', label: t('newSessionProject.mode.none') },
          ]}
          onChange={chooseMode}
          ariaLabel={t('newSessionProject.mode.label')}
        />
      </SettingsRow>
      {preference.mode === 'fixed' && (
        <SettingsRow stacked label={t('newSessionProject.project.label')}>
          <SettingsSelect
            value={fixedKey}
            options={[
              ...(fixedProject ? [] : [{ value: NO_PROJECT, label: t('newSessionProject.project.placeholder') }]),
              ...entries.map((entry) => ({ value: entry.key, label: entry.displayName })),
            ]}
            onChange={chooseProject}
            ariaLabel={t('newSessionProject.project.label')}
          />
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

/**
 * Git identity saves on blur — debounced, so tabbing
 * from name straight into email coalesces into one write — rather than the
 * old explicit Save button, since these are real `git config --global` writes
 * and never per-keystroke.
 */
export default function ProjectsGitScreen({ projects }: ProjectsGitScreenProps) {
  const { t } = useTranslation('settings');
  const {
    gitName,
    setGitName,
    gitEmail,
    setGitEmail,
    isLoading,
    saveStatus,
    handleFieldBlur,
  } = useGitSettings();

  return (
    <SettingsScreen>
      <NewSessionProjectGroup projects={projects} />
      <SettingsGroup title={t('git.title')} description={t('git.description')} divided>
        <SettingsRow stacked label={t('git.name.label')} description={t('git.name.help')}>
          <SettingsTextField
            value={gitName}
            onChange={setGitName}
            onBlur={handleFieldBlur}
            disabled={isLoading}
            placeholder="John Doe"
            ariaLabel={t('git.name.label')}
          />
        </SettingsRow>
        <SettingsRow stacked label={t('git.email.label')} description={t('git.email.help')}>
          <SettingsTextField
            type="email"
            value={gitEmail}
            onChange={setGitEmail}
            onBlur={handleFieldBlur}
            disabled={isLoading}
            placeholder="john@example.com"
            ariaLabel={t('git.email.label')}
          />
        </SettingsRow>
        {saveStatus && (
          <div className="px-4 pb-4">
            <span className={`text-xs ${saveStatus === 'success' ? 'text-primary' : 'text-destructive'}`}>
              {saveStatus === 'success' ? t('git.status.success') : t('saveStatus.error')}
            </span>
          </div>
        )}
      </SettingsGroup>
    </SettingsScreen>
  );
}
