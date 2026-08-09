import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
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
import { useLongPress } from '../../../../hooks/useLongPress';

import { ComposerMenuItem, ComposerMenuSeparator, ComposerMenuSurface } from './ComposerMenuPrimitives';

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
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 17 * 16);
  const openMenu = useCallback(() => {
    updateAnchor();
    setIsOpen(true);
  }, [updateAnchor]);
  const { handlers: longPressHandlers, isPressing } = useLongPress(() => openMenu());

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

  return (
    <>
      <div className="flex shrink-0 items-center">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => onSelectPermissionMode(nextRoutineMode)}
          {...longPressHandlers}
          className={`flex h-8 max-w-28 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground sm:rounded-r-none ${
            isPressing ? 'scale-95 bg-muted text-foreground' : ''
          }`}
          aria-label={`${heading} ${permissionModeLabel}. ${t('composer.togglePermissionMode', {
            mode: nextRoutineModeLabel,
            defaultValue: 'Switch to {{mode}}',
          })}`}
          title={t('composer.permissionQuickToggle', {
            mode: nextRoutineModeLabel,
            defaultValue: 'Switch to {{mode}}. Long press for all access modes.',
          })}
        >
          <span className="relative shrink-0">
            <ActiveIcon className="h-4 w-4" aria-hidden />
            {isPlanning && (
              <ClipboardList
                className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-sm bg-background text-primary sm:hidden"
                aria-hidden
              />
            )}
          </span>
          <span className="hidden truncate sm:inline">{permissionModeLabel}</span>
        </button>

        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            if (isOpen) {
              close();
            } else {
              openMenu();
            }
          }}
          className="hidden h-8 w-5 shrink-0 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label={t('composer.openPermissionMenu', { defaultValue: 'Show all access modes' })}
          title={t('composer.openPermissionMenu', { defaultValue: 'Show all access modes' })}
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      {collaborationMode && collaborationModes.length > 0 && (
        <div
          role="radiogroup"
          aria-label={t('composer.collaborationHeading', { defaultValue: 'Collaboration mode' })}
          className="hidden h-8 shrink-0 items-center gap-0.5 sm:flex"
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
                  ? 'flex h-8 items-center gap-1 rounded-md bg-muted px-1.5 text-xs font-medium text-foreground'
                  : 'flex h-8 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'}
              >
                <ModeIcon className="h-3.5 w-3.5" aria-hidden />
                {t(`composer.collaborationModes.${mode}`, { defaultValue: mode })}
              </button>
            );
          })}
        </div>
      )}

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={heading}>
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
                      setIsOpen(false);
                    }}
                    className={appearance.item}
                  />
                );
              })}
            </div>

            {collaborationMode && collaborationModes.length > 0 && (
              <>
                <ComposerMenuSeparator />
                <div className="px-2 pb-1.5 pt-1 sm:hidden" role="group" aria-label={t('composer.collaborationHeading', { defaultValue: 'Collaboration mode' })}>
                  <div className="mb-1.5 px-0.5 text-xs text-muted-foreground">
                    {t('composer.mode', { defaultValue: 'Mode' })}
                  </div>
                  <div
                    role="radiogroup"
                    aria-label={t('composer.collaborationHeading', { defaultValue: 'Collaboration mode' })}
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
          </div>
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
