import { AlertTriangle, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import { Button, Input } from '../../../../shared/view/ui';
import type { AgentProviderId } from '../../registry/registry';
import type {
  ClaudePermissionsState,
  CodexPermissionMode,
  CursorPermissionsState,
} from '../../types/types';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsToggle } from '../primitives';

const COMMON_CLAUDE_TOOLS = [
  'Bash(git log:*)',
  'Bash(git diff:*)',
  'Bash(git status:*)',
  'Write',
  'Read',
  'Edit',
  'Glob',
  'Grep',
  'MultiEdit',
  'Task',
  'TodoWrite',
  'TodoRead',
  'WebFetch',
  'WebSearch',
];

const COMMON_CURSOR_COMMANDS = [
  'Shell(ls)',
  'Shell(mkdir)',
  'Shell(cd)',
  'Shell(cat)',
  'Shell(echo)',
  'Shell(git status)',
  'Shell(git diff)',
  'Shell(git log)',
  'Shell(npm install)',
  'Shell(npm run)',
  'Shell(python)',
  'Shell(node)',
];

const addUnique = (items: string[], value: string): string[] => {
  const normalizedValue = value.trim();
  if (!normalizedValue || items.includes(normalizedValue)) {
    return items;
  }

  return [...items, normalizedValue];
};

const removeValue = (items: string[], value: string): string[] => (
  items.filter((item) => item !== value)
);

type SkipPermissionsGroupProps = {
  checked: boolean;
  onChange: (value: boolean) => void;
  description: string;
};

/**
 * The dangerous control, and the reason `tone="warning"` exists: it used to be a
 * raw checkbox on a hardcoded `bg-orange-50 dark:bg-orange-900/20` card.
 */
function SkipPermissionsGroup({ checked, onChange, description }: SkipPermissionsGroupProps) {
  const { t } = useTranslation('settings');

  return (
    <SettingsGroup tone="warning">
      <SettingsRow
        icon={<AlertTriangle className="h-5 w-5 text-warning" />}
        label={t('permissions.skipPermissions.label')}
        description={description}
      >
        <SettingsToggle
          checked={checked}
          onChange={onChange}
          ariaLabel={t('permissions.skipPermissions.label')}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

type PermissionListGroupProps = {
  title: string;
  description: string;
  placeholder: string;
  emptyLabel: string;
  values: string[];
  onChange: (values: string[]) => void;
  quickAdd?: { label: string; values: string[] };
  /** Blocked lists mark their entries with the destructive token. */
  isBlockList?: boolean;
};

/**
 * One editor for all four allow/deny lists. Claude's tool lists and Cursor's
 * command lists were four copies of the same 60 lines in `PermissionsContent`,
 * differing only in labels and in which literal colour tinted each entry.
 */
function PermissionListGroup({
  title,
  description,
  placeholder,
  emptyLabel,
  values,
  onChange,
  quickAdd,
  isBlockList = false,
}: PermissionListGroupProps) {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState('');

  const add = (value: string) => {
    const updated = addUnique(values, value);
    if (updated.length === values.length) {
      return;
    }

    onChange(updated);
    setDraft('');
  };

  return (
    <SettingsGroup title={title} description={description} divided>
      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add(draft);
              }
            }}
            className="h-10 flex-1"
          />
          <Button
            onClick={() => add(draft)}
            disabled={!draft.trim()}
            size="sm"
            // The label is hidden from `sm:` up, where the button is icon-only,
            // so it needs an accessible name of its own.
            aria-label={t('permissions.actions.add')}
            className="h-10 px-4"
          >
            <Plus className="mr-2 h-4 w-4 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        {quickAdd && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{quickAdd.label}</p>
            <div className="flex flex-wrap gap-2">
              {quickAdd.values.map((value) => (
                <Button
                  key={value}
                  variant="outline"
                  size="sm"
                  onClick={() => add(value)}
                  disabled={values.includes(value)}
                  className="h-8 text-xs"
                >
                  {value}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {values.map((value) => (
        <div key={value} className="flex items-center justify-between gap-2 px-4 py-3">
          <span
            className={cn(
              'min-w-0 truncate font-mono text-sm',
              isBlockList ? 'text-destructive' : 'text-foreground',
            )}
          >
            {value}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(removeValue(values, value))}
            aria-label={t('permissions.actions.remove', { defaultValue: 'Remove' })}
            className="flex-shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {values.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
      )}
    </SettingsGroup>
  );
}

type ExamplesGroupProps = {
  title: string;
  examples: { code: string; description: string }[];
};

function ExamplesGroup({ title, examples }: ExamplesGroupProps) {
  return (
    <SettingsGroup title={title}>
      <ul className="space-y-1 p-4 text-sm text-muted-foreground">
        {examples.map((example) => (
          <li key={example.code}>
            <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">
              {example.code}
            </code>
            {' '}
            {example.description}
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}

type ClaudePermissionsProps = {
  permissions: ClaudePermissionsState;
  onChange: (value: ClaudePermissionsState) => void;
};

function ClaudePermissions({ permissions, onChange }: ClaudePermissionsProps) {
  const { t } = useTranslation('settings');

  return (
    <>
      <SkipPermissionsGroup
        checked={permissions.skipPermissions}
        onChange={(value) => onChange({ ...permissions, skipPermissions: value })}
        description={t('permissions.skipPermissions.claudeDescription')}
      />

      <PermissionListGroup
        title={t('permissions.allowedTools.title')}
        description={t('permissions.allowedTools.description')}
        placeholder={t('permissions.allowedTools.placeholder')}
        emptyLabel={t('permissions.allowedTools.empty')}
        values={permissions.allowedTools}
        onChange={(value) => onChange({ ...permissions, allowedTools: value })}
        quickAdd={{ label: t('permissions.allowedTools.quickAdd'), values: COMMON_CLAUDE_TOOLS }}
      />

      <PermissionListGroup
        isBlockList
        title={t('permissions.blockedTools.title')}
        description={t('permissions.blockedTools.description')}
        placeholder={t('permissions.blockedTools.placeholder')}
        emptyLabel={t('permissions.blockedTools.empty')}
        values={permissions.disallowedTools}
        onChange={(value) => onChange({ ...permissions, disallowedTools: value })}
      />

      <ExamplesGroup
        title={t('permissions.toolExamples.title')}
        examples={[
          { code: '"Bash(git log:*)"', description: t('permissions.toolExamples.bashGitLog') },
          { code: '"Bash(git diff:*)"', description: t('permissions.toolExamples.bashGitDiff') },
          { code: '"Write"', description: t('permissions.toolExamples.write') },
          { code: '"Bash(rm:*)"', description: t('permissions.toolExamples.bashRm') },
        ]}
      />
    </>
  );
}

type CursorPermissionsProps = {
  permissions: CursorPermissionsState;
  onChange: (value: CursorPermissionsState) => void;
};

function CursorPermissions({ permissions, onChange }: CursorPermissionsProps) {
  const { t } = useTranslation('settings');

  return (
    <>
      <SkipPermissionsGroup
        checked={permissions.skipPermissions}
        onChange={(value) => onChange({ ...permissions, skipPermissions: value })}
        description={t('permissions.skipPermissions.cursorDescription')}
      />

      <PermissionListGroup
        title={t('permissions.allowedCommands.title')}
        description={t('permissions.allowedCommands.description')}
        placeholder={t('permissions.allowedCommands.placeholder')}
        emptyLabel={t('permissions.allowedCommands.empty')}
        values={permissions.allowedCommands}
        onChange={(value) => onChange({ ...permissions, allowedCommands: value })}
        quickAdd={{ label: t('permissions.allowedCommands.quickAdd'), values: COMMON_CURSOR_COMMANDS }}
      />

      <PermissionListGroup
        isBlockList
        title={t('permissions.blockedCommands.title')}
        description={t('permissions.blockedCommands.description')}
        placeholder={t('permissions.blockedCommands.placeholder')}
        emptyLabel={t('permissions.blockedCommands.empty')}
        values={permissions.disallowedCommands}
        onChange={(value) => onChange({ ...permissions, disallowedCommands: value })}
      />

      <ExamplesGroup
        title={t('permissions.shellExamples.title')}
        examples={[
          { code: '"Shell(ls)"', description: t('permissions.shellExamples.ls') },
          { code: '"Shell(git status)"', description: t('permissions.shellExamples.gitStatus') },
          { code: '"Shell(npm install)"', description: t('permissions.shellExamples.npmInstall') },
          { code: '"Shell(rm -rf)"', description: t('permissions.shellExamples.rmRf') },
        ]}
      />
    </>
  );
}

type CodexPermissionsProps = {
  mode: CodexPermissionMode;
  onChange: (value: CodexPermissionMode) => void;
};

const CODEX_MODES: { value: CodexPermissionMode; isDangerous?: boolean }[] = [
  { value: 'default' },
  { value: 'acceptEdits' },
  { value: 'bypassPermissions', isDangerous: true },
];

function CodexPermissions({ mode, onChange }: CodexPermissionsProps) {
  const { t } = useTranslation('settings');

  return (
    <>
      <SettingsGroup
        title={t('permissions.codex.permissionMode')}
        description={t('permissions.codex.description')}
        divided
      >
        <div role="radiogroup" aria-label={t('permissions.codex.permissionMode')}>
          {CODEX_MODES.map(({ value, isDangerous }) => {
            const isSelected = mode === value;

            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onChange(value)}
                className={cn(
                  'flex w-full touch-manipulation items-start gap-3 border-b border-border px-4 py-4 text-left transition-colors duration-150 last:border-b-0',
                  isSelected ? 'bg-accent' : 'hover:bg-accent/50 active:bg-accent/50',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2',
                    isSelected ? 'border-primary' : 'border-input',
                  )}
                >
                  {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'flex items-center gap-2 text-sm font-medium',
                      isDangerous ? 'text-warning' : 'text-foreground',
                    )}
                  >
                    {t(`permissions.codex.modes.${value}.title`)}
                    {isDangerous && <AlertTriangle className="h-4 w-4" />}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {t(`permissions.codex.modes.${value}.description`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          {t('permissions.codex.technicalDetails')}
        </summary>
        <div className="mt-2 space-y-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
          {CODEX_MODES.map(({ value }) => (
            <p key={value}>
              <strong>{t(`permissions.codex.modes.${value}.title`)}:</strong>
              {' '}
              {t(`permissions.codex.technicalInfo.${value}`)}
            </p>
          ))}
          <p className="text-xs opacity-75">{t('permissions.codex.technicalInfo.overrideNote')}</p>
        </div>
      </details>
    </>
  );
}

type AgentPermissionsScreenProps = {
  provider: AgentProviderId;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
};

/**
 * Provider-branched exactly as before the restructure — Claude gets
 * skip-permissions plus tool allow/deny lists, Cursor the same over commands,
 * Codex a permission-mode choice — only the chrome changed. OpenCode has no
 * permissions UI and no registry entry for this screen, so it is unreachable
 * rather than blank, which is what it used to be.
 *
 * Everything here autosaves through `useSettingsController`'s debounced write;
 * per the IA spec's save model, a toggle's or radio's own state is its
 * confirmation, so there is no "Saved" text on this screen.
 */
export default function AgentPermissionsScreen({
  provider,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
}: AgentPermissionsScreenProps) {
  return (
    <SettingsScreen>
      {provider === 'claude' && (
        <ClaudePermissions
          permissions={claudePermissions}
          onChange={onClaudePermissionsChange}
        />
      )}

      {provider === 'cursor' && (
        <CursorPermissions
          permissions={cursorPermissions}
          onChange={onCursorPermissionsChange}
        />
      )}

      {provider === 'codex' && (
        <CodexPermissions
          mode={codexPermissionMode}
          onChange={onCodexPermissionModeChange}
        />
      )}
    </SettingsScreen>
  );
}
