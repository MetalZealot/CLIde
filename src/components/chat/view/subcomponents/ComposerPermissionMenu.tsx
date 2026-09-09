import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList,
  FileCheck,
  Hammer,
  Shield,
  ShieldOff,
  ShieldQuestion,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { CollaborationMode, PermissionMode } from '../../types/types';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import { getNextRoutinePermissionMode } from '../../utils/chatPermissions';
import { useDeviceSettings } from '../../../../hooks/useDeviceSettings';

import { ComposerMenuItem, ComposerMenuSeparator, ComposerMenuSurface } from './ComposerMenuPrimitives';
import ComposerSplitControl from './ComposerSplitControl';

type ModeAppearance = { icon: LucideIcon; item: string };

const MODE_APPEARANCE: Record<PermissionMode, ModeAppearance> = {
  default: { icon: Shield, item: 'text-foreground' },
  auto: { icon: Zap, item: 'text-blue-700 dark:text-blue-300' },
  acceptEdits: { icon: FileCheck, item: 'text-green-700 dark:text-green-300' },
  bypassPermissions: { icon: ShieldOff, item: 'text-orange-600 dark:text-orange-400' },
  plan: { icon: ClipboardList, item: 'text-primary' },
};

const UNKNOWN_MODE: ModeAppearance = { icon: ShieldQuestion, item: 'text-foreground' };
const getAppearance = (mode: PermissionMode | string) => MODE_APPEARANCE[mode as PermissionMode] ?? UNKNOWN_MODE;

interface ComposerPermissionMenuProps {
  permissionMode: PermissionMode | string;
  permissionModes: (PermissionMode | string)[];
  onSelectPermissionMode: (mode: PermissionMode | string) => void;
  collaborationMode: CollaborationMode | null;
  collaborationModes: CollaborationMode[];
  onSelectCollaborationMode: (mode: CollaborationMode) => void;
  provider?: string;
  providerLabel: string;
}

export default function ComposerPermissionMenu({
  permissionMode,
  permissionModes,
  onSelectPermissionMode,
  collaborationMode,
  collaborationModes,
  onSelectCollaborationMode,
  provider,
  providerLabel,
}: ComposerPermissionMenuProps) {
  const { t } = useTranslation('chat');
  const { isMobile: isCompactComposer } = useDeviceSettings({
    mobileBreakpoint: 640,
    trackPWA: false,
  });
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [collaborationMenuOpen, setCollaborationMenuOpen] = useState(false);
  const closePermissionMenu = useCallback(() => setPermissionMenuOpen(false), []);
  const closeCollaborationMenu = useCallback(() => setCollaborationMenuOpen(false), []);
  const {
    triggerRef: permissionTriggerRef,
    menuRef: permissionMenuRef,
    anchor: permissionAnchor,
    updateAnchor: updatePermissionAnchor,
  } = useComposerMenuAnchor(
    permissionMenuOpen,
    closePermissionMenu,
    17 * 16,
  );
  const {
    triggerRef: collaborationTriggerRef,
    menuRef: collaborationMenuRef,
    anchor: collaborationAnchor,
    updateAnchor: updateCollaborationAnchor,
  } = useComposerMenuAnchor(
    collaborationMenuOpen,
    closeCollaborationMenu,
    17 * 16,
  );
  const openPermissionMenu = useCallback(() => {
    setCollaborationMenuOpen(false);
    updatePermissionAnchor();
    setPermissionMenuOpen(true);
  }, [updatePermissionAnchor]);
  const openCollaborationMenu = useCallback(() => {
    setPermissionMenuOpen(false);
    updateCollaborationAnchor();
    setCollaborationMenuOpen(true);
  }, [updateCollaborationAnchor]);

  if (permissionModes.length === 0) return null;

  const getModeLabel = (mode: PermissionMode | string) => t(
    `composer.permissionOptions.${provider}.${mode}.label`,
    { defaultValue: t(`codex.modes.${mode}`, { defaultValue: mode }) },
  );
  const getModeDescription = (mode: PermissionMode | string) => t(
    `composer.permissionOptions.${provider}.${mode}.description`,
    {
      defaultValue: t(`permissionModeDetails.${provider}.${mode}`, {
        defaultValue: t('permissionModeDetails.fallback', { defaultValue: '' }),
      }),
    },
  );
  const isPlanning = collaborationMode === 'plan';
  const ActiveIcon = getAppearance(permissionMode).icon;
  const permissionModeLabel = getModeLabel(permissionMode);
  const nextRoutineMode = getNextRoutinePermissionMode(permissionMode, permissionModes);
  const nextRoutineModeLabel = getModeLabel(nextRoutineMode);
  const heading = t('composer.permissionHeading', {
    provider: providerLabel,
    defaultValue: 'How should {{provider}} actions be approved?',
  });
  const hasCollaborationModes = collaborationMode !== null && collaborationModes.length > 0;
  const collaborationModeLabel = collaborationMode
    ? t(`composer.collaborationModes.${collaborationMode}`, { defaultValue: collaborationMode })
    : '';
  const collaborationModeIndex = collaborationMode
    ? collaborationModes.indexOf(collaborationMode)
    : -1;
  const nextCollaborationMode = hasCollaborationModes
    ? collaborationModes[(collaborationModeIndex + 1) % collaborationModes.length]
    : null;
  const nextCollaborationModeLabel = nextCollaborationMode
    ? t(`composer.collaborationModes.${nextCollaborationMode}`, { defaultValue: nextCollaborationMode })
    : '';
  const ActiveCollaborationIcon = collaborationMode === 'plan' ? ClipboardList : Hammer;
  const collaborationHeading = t('composer.collaborationHeading', {
    defaultValue: 'Collaboration mode',
  });
  const openPermissionMenuLabel = t('composer.openPermissionMenu', {
    defaultValue: 'Show all access modes',
  });
  const openCollaborationMenuLabel = t('composer.openCollaborationMenu', {
    defaultValue: 'Show collaboration modes',
  });
  const togglePermissionMenu = () => {
    if (permissionMenuOpen) {
      closePermissionMenu();
    } else {
      openPermissionMenu();
    }
  };
  const toggleCollaborationMenu = () => {
    if (collaborationMenuOpen) {
      closeCollaborationMenu();
    } else {
      openCollaborationMenu();
    }
  };

  return (
    <>
      <ComposerSplitControl
        triggerRef={permissionTriggerRef}
        icon={(
          <span className="relative shrink-0">
            <ActiveIcon className="h-4 w-4" aria-hidden />
            {isPlanning && (
              <ClipboardList
                className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-sm bg-background text-primary sm:hidden"
                aria-hidden
              />
            )}
          </span>
        )}
        label={permissionModeLabel}
        onMainClick={() => {
          if (isCompactComposer) {
            togglePermissionMenu();
          } else {
            onSelectPermissionMode(nextRoutineMode);
          }
        }}
        mainAriaLabel={isCompactComposer
          ? `${heading} ${permissionModeLabel}. ${openPermissionMenuLabel}`
          : `${heading} ${permissionModeLabel}. ${t('composer.togglePermissionMode', {
              mode: nextRoutineModeLabel,
              defaultValue: 'Switch to {{mode}}',
            })}`}
        mainTitle={isCompactComposer
          ? openPermissionMenuLabel
          : t('composer.permissionQuickToggle', {
              mode: nextRoutineModeLabel,
              defaultValue: 'Switch to {{mode}}',
            })}
        mainOpensMenu={isCompactComposer}
        menuOpen={permissionMenuOpen}
        onMenuClick={togglePermissionMenu}
        menuAriaLabel={openPermissionMenuLabel}
        mainButtonClassName="rounded-md sm:rounded-r-none"
        menuButtonClassName="hidden sm:flex"
      />

      {hasCollaborationModes && nextCollaborationMode && (
        <ComposerSplitControl
          triggerRef={collaborationTriggerRef}
          icon={<ActiveCollaborationIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          label={collaborationModeLabel}
          onMainClick={() => onSelectCollaborationMode(nextCollaborationMode)}
          mainAriaLabel={`${collaborationHeading} ${collaborationModeLabel}. ${t('composer.toggleCollaborationMode', {
            mode: nextCollaborationModeLabel,
            defaultValue: 'Switch to {{mode}}',
          })}`}
          mainTitle={t('composer.collaborationQuickToggle', {
            mode: nextCollaborationModeLabel,
            defaultValue: 'Switch to {{mode}} (Shift+Tab)',
          })}
          menuOpen={collaborationMenuOpen}
          onMenuClick={toggleCollaborationMenu}
          menuAriaLabel={openCollaborationMenuLabel}
          className="hidden sm:flex"
          mainButtonClassName="max-w-24"
        />
      )}

      {permissionMenuOpen && permissionAnchor && createPortal(
        <ComposerMenuSurface
          anchor={permissionAnchor}
          menuRef={permissionMenuRef}
          ariaLabel={heading}
        >
          <div className="w-64 max-w-full">
            <div className="py-0.5">
              <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground">
                {t('composer.permissions', { defaultValue: 'Permissions' })}
              </div>
              {permissionModes.map((mode) => {
                const appearance = getAppearance(mode);
                const ModeIcon = appearance.icon;
                return (
                  <ComposerMenuItem
                    key={mode}
                    icon={<ModeIcon className="h-4 w-4" />}
                    label={getModeLabel(mode)}
                    description={getModeDescription(mode) || undefined}
                    isSelected={mode === permissionMode}
                    onSelect={() => {
                      onSelectPermissionMode(mode);
                      setPermissionMenuOpen(false);
                    }}
                    className={appearance.item}
                  />
                );
              })}
            </div>
            {hasCollaborationModes && collaborationMode && (
              <>
                <ComposerMenuSeparator />
                <div
                  className="px-2 pb-1.5 pt-1 sm:hidden"
                  role="group"
                  aria-label={collaborationHeading}
                >
                  <div className="mb-1.5 px-0.5 text-xs text-muted-foreground">
                    {t('composer.mode', { defaultValue: 'Mode' })}
                  </div>
                  <div
                    role="radiogroup"
                    aria-label={collaborationHeading}
                    className="grid h-8 rounded-lg bg-muted/70 p-0.5"
                    style={{ gridTemplateColumns: `repeat(${collaborationModes.length}, minmax(0, 1fr))` }}
                  >
                    {collaborationModes.map((mode) => {
                      const isSelected = mode === collaborationMode;
                      const ModeIcon = mode === 'plan' ? ClipboardList : Hammer;
                      return (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => onSelectCollaborationMode(mode)}
                          className={isSelected
                            ? 'flex items-center justify-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground shadow-sm'
                            : 'flex items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground'}
                        >
                          <ModeIcon className="h-3.5 w-3.5" aria-hidden />
                          {t(`composer.collaborationModes.${mode}`, { defaultValue: mode })}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <ComposerMenuSeparator />
            <div className="px-2.5 py-1 text-[11px] text-muted-foreground">
              <kbd className="font-mono text-foreground">Tab</kbd>{' '}
              {t('composer.permissionShortcut', { defaultValue: 'cycles permissions' })}
            </div>
          </div>
        </ComposerMenuSurface>,
        document.body,
      )}

      {collaborationMenuOpen && collaborationAnchor && collaborationMode && createPortal(
        <ComposerMenuSurface
          anchor={collaborationAnchor}
          menuRef={collaborationMenuRef}
          ariaLabel={collaborationHeading}
        >
          <div className="w-64 max-w-full">
            <div className="py-0.5">
              <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground">
                {collaborationHeading}
              </div>
              {collaborationModes.map((mode) => {
                const ModeIcon = mode === 'plan' ? ClipboardList : Hammer;
                return (
                  <ComposerMenuItem
                    key={mode}
                    icon={<ModeIcon className="h-4 w-4" />}
                    label={t(`composer.collaborationModes.${mode}`, { defaultValue: mode })}
                    description={t(`composer.collaborationModeDescriptions.${mode}`, {
                      defaultValue: mode === 'plan'
                        ? 'Investigate and agree an approach before implementation'
                        : 'Implement changes and complete the task',
                    })}
                    isSelected={mode === collaborationMode}
                    onSelect={() => {
                      onSelectCollaborationMode(mode);
                      setCollaborationMenuOpen(false);
                    }}
                    className={mode === 'plan' ? 'text-primary' : 'text-foreground'}
                  />
                );
              })}
            </div>
            <ComposerMenuSeparator />
            <div className="px-2.5 py-1 text-[11px] text-muted-foreground">
              <kbd className="font-mono text-foreground">Shift+Tab</kbd>{' '}
              {t('composer.collaborationShortcut', { defaultValue: 'cycles Build and Plan' })}
            </div>
          </div>
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
