import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { ArrowDown, ArrowUp, MoreVertical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  MAX_THINKING_MESSAGE_LENGTH,
  MAX_THINKING_MESSAGES,
  THINKING_MESSAGE_CYCLE_MODES,
  THINKING_MESSAGE_ORDERS,
  type ThinkingMessageCycleMode,
  type ThinkingMessageOrder,
} from '../../../../hooks/useThinkingMessages';
import { cn } from '../../../../lib/utils';
import {
  Button,
  ContextMenuOverlay,
  Dialog,
  DialogContent,
  anchorFromElement,
  type ContextMenuAnchor,
} from '../../../../shared/view/ui';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSelect,
} from '../primitives';

type ThinkingMessagesEditorProps = {
  messages: string[];
  cycleMode: ThinkingMessageCycleMode;
  messageOrder: ThinkingMessageOrder;
  isCustom: boolean;
  onChange: (messages: string[]) => void;
  onCycleModeChange: (mode: ThinkingMessageCycleMode) => void;
  onMessageOrderChange: (order: ThinkingMessageOrder) => void;
  onReset: () => void;
};

export default function ThinkingMessagesEditor({
  messages,
  cycleMode,
  messageOrder,
  isCustom,
  onChange,
  onCycleModeChange,
  onMessageOrderChange,
  onReset,
}: ThinkingMessagesEditorProps) {
  const { t } = useTranslation('settings');
  const idPrefix = useId();
  const [newMessage, setNewMessage] = useState('');
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState<{
    index: number;
    anchor: ContextMenuAnchor;
  } | null>(null);
  const actionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const messageInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const newMessageInputRef = useRef<HTMLInputElement | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!actionMenu) return undefined;

    const frame = window.requestAnimationFrame(() => firstMenuItemRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [actionMenu]);

  const updateMessage = (index: number, value: string) => {
    onChange(messages.map((message, messageIndex) => messageIndex === index ? value : message));
  };

  // Blanks are tolerated while the caret is still in the list — you may be retyping a
  // row — and dropped the moment focus leaves it, so the list is only ever what runs.
  const pruneBlankMessages = (event: FocusEvent<HTMLInputElement>) => {
    const nextFocused = event.relatedTarget as HTMLElement | null;
    if (nextFocused?.dataset.activityMessageControl !== undefined) return;

    const filled = messages.filter((message) => message.trim());
    if (filled.length !== messages.length) onChange(filled);
  };

  const moveMessage = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= messages.length) return;

    const reordered = [...messages];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    onChange(reordered);
  };

  const addMessage = () => {
    const message = newMessage.trim();
    if (!message || messages.length >= MAX_THINKING_MESSAGES) return;
    onChange([...messages, message]);
    setNewMessage('');
  };

  const closeActionMenu = (focusIndex = actionMenu?.index) => {
    setActionMenu(null);
    if (focusIndex === undefined) return;
    window.requestAnimationFrame(() => actionButtonRefs.current[focusIndex]?.focus());
  };

  const moveFromMenu = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    moveMessage(index, offset);
    closeActionMenu(destination);
  };

  const deleteFromMenu = (index: number) => {
    setActionMenu(null);
    onChange(messages.filter((_, messageIndex) => messageIndex !== index));
    window.requestAnimationFrame(() => {
      const nextIndex = Math.min(index, messages.length - 2);
      if (nextIndex >= 0) {
        messageInputRefs.current[nextIndex]?.focus();
      } else {
        newMessageInputRef.current?.focus();
      }
    });
  };

  const menuItemClassName = (disabled: boolean, isDanger = false) => cn(
    'flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
    'focus:outline-none',
    disabled
      ? 'cursor-not-allowed opacity-40'
      : isDanger
        ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50 active:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 dark:focus-visible:bg-red-950 dark:active:bg-red-950'
        : 'text-foreground hover:bg-accent focus-visible:bg-accent active:bg-accent',
  );

  const cycleDescription = cycleMode === 'never'
    ? t('chat.activityMessages.cycleDescriptionNever')
    : cycleMode === 'turn'
      ? t('chat.activityMessages.cycleDescriptionTurn')
      : t('chat.activityMessages.cycleDescriptionSeconds', { seconds: Number(cycleMode) });
  const cycleOptions = THINKING_MESSAGE_CYCLE_MODES.map((mode) => ({
    value: mode,
    label: mode === 'never'
      ? t('chat.activityMessages.cycleNever')
      : mode === 'turn'
        ? t('chat.activityMessages.cycleTurn')
        : t('chat.activityMessages.cycleSeconds', { seconds: Number(mode) }),
  }));
  const orderOptions = THINKING_MESSAGE_ORDERS.map((order) => ({
    value: order,
    label: order === 'listed'
      ? t('chat.activityMessages.orderListed')
      : t('chat.activityMessages.orderRandom'),
  }));
  const resetTitleId = `${idPrefix}-reset-title`;
  const resetDescriptionId = `${idPrefix}-reset-description`;

  return (
    <>
      <SettingsGroup divided>
        <SettingsRow
          stacked
          label={t('chat.activityMessages.cycleLabel')}
          description={cycleDescription}
        >
          <SettingsSelect
            value={cycleMode}
            options={cycleOptions}
            onChange={onCycleModeChange}
            ariaLabel={t('chat.activityMessages.cycleLabel')}
          />
        </SettingsRow>

        <SettingsRow
          stacked
          label={t('chat.activityMessages.orderLabel')}
          description={t('chat.activityMessages.orderDescription')}
        >
          <SettingsSegmentedControl
            value={messageOrder}
            options={orderOptions}
            onChange={onMessageOrderChange}
            ariaLabel={t('chat.activityMessages.orderLabel')}
            disabled={cycleMode === 'never'}
            className="w-full justify-between [&>button]:min-h-11"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        divided
        title={t('chat.activityMessages.listTitle')}
        description={t('chat.activityMessages.listDescription', { max: MAX_THINKING_MESSAGES })}
      >
        {messages.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            {t('chat.activityMessages.empty')}
          </p>
        ) : messages.map((message, index) => {
          const inputId = `${idPrefix}-${index}`;
          const displayName = message.trim() || t('chat.activityMessages.blank');
          return (
            <div key={inputId} className="flex items-center gap-1 py-1 pe-2 ps-2">
              <label className="sr-only" htmlFor={inputId}>
                {t('chat.activityMessages.messageLabel', { number: index + 1 })}
              </label>
              {/* Borderless until hover or focus: the group's hairlines already
                  separate the rows, so a box per row draws the list twice. */}
              <input
                ref={(node) => {
                  messageInputRefs.current[index] = node;
                }}
                id={inputId}
                name={`thinking-message-${index + 1}`}
                type="text"
                value={message}
                maxLength={MAX_THINKING_MESSAGE_LENGTH}
                autoComplete="off"
                data-activity-message-control=""
                onChange={(event) => updateMessage(index, event.target.value)}
                onBlur={pruneBlankMessages}
                className="min-h-11 min-w-0 flex-1 touch-manipulation rounded-lg border border-transparent bg-transparent px-2 text-base text-foreground hover:border-input focus:border-primary focus:ring-1 focus:ring-primary sm:text-sm"
              />
              <button
                ref={(node) => {
                  actionButtonRefs.current[index] = node;
                }}
                type="button"
                data-activity-message-control=""
                aria-haspopup="menu"
                aria-expanded={actionMenu?.index === index}
                aria-label={t('chat.activityMessages.actions', { message: displayName })}
                title={t('chat.activityMessages.actions', { message: displayName })}
                onClick={(event) => setActionMenu({
                  index,
                  anchor: anchorFromElement(event.currentTarget, {
                    x: event.clientX,
                    y: event.clientY,
                  }),
                })}
                className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreVertical className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}

        <form
          className="flex items-center gap-2 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            addMessage();
          }}
        >
          <label className="sr-only" htmlFor={`${idPrefix}-new`}>
            {t('chat.activityMessages.newMessage')}
          </label>
          <input
            ref={newMessageInputRef}
            id={`${idPrefix}-new`}
            name="new-thinking-message"
            type="text"
            value={newMessage}
            maxLength={MAX_THINKING_MESSAGE_LENGTH}
            autoComplete="off"
            placeholder={t('chat.activityMessages.placeholder')}
            onChange={(event) => setNewMessage(event.target.value)}
            className="min-h-11 min-w-0 flex-1 touch-manipulation rounded-lg border border-input bg-card px-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!newMessage.trim() || messages.length >= MAX_THINKING_MESSAGES}
            className="h-11 shrink-0 px-4"
          >
            <Plus aria-hidden />
            {t('chat.activityMessages.add')}
          </Button>
        </form>
      </SettingsGroup>

      <SettingsGroup
        title={t('chat.activityMessages.defaultsTitle')}
        description={t('chat.activityMessages.defaultsDescription')}
      >
        <div className="p-4">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="min-h-11"
            disabled={!isCustom}
            onClick={() => setIsResetConfirmOpen(true)}
          >
            <RotateCcw aria-hidden />
            {t('chat.activityMessages.reset')}
          </Button>
        </div>
      </SettingsGroup>

      {actionMenu && (() => {
        const { index, anchor } = actionMenu;
        const message = messages[index];
        const displayName = message?.trim() || t('chat.activityMessages.blank');
        const canMoveUp = index > 0;
        const canMoveDown = index < messages.length - 1;

        return (
          <ContextMenuOverlay
            anchor={anchor}
            onDismiss={() => closeActionMenu()}
            ariaLabel={t('chat.activityMessages.actions', { message: displayName })}
            className="min-w-44 max-w-64 overflow-hidden rounded-xl py-1"
            measureKey={`${index}-${messages.length}`}
          >
            <button
              ref={canMoveUp ? firstMenuItemRef : undefined}
              type="button"
              role="menuitem"
              disabled={!canMoveUp}
              onClick={() => moveFromMenu(index, -1)}
              className={menuItemClassName(!canMoveUp)}
            >
              <ArrowUp className="h-4 w-4 flex-shrink-0" aria-hidden />
              <span>{t('chat.activityMessages.moveUp')}</span>
            </button>
            <button
              ref={!canMoveUp && canMoveDown ? firstMenuItemRef : undefined}
              type="button"
              role="menuitem"
              disabled={!canMoveDown}
              onClick={() => moveFromMenu(index, 1)}
              className={menuItemClassName(!canMoveDown)}
            >
              <ArrowDown className="h-4 w-4 flex-shrink-0" aria-hidden />
              <span>{t('chat.activityMessages.moveDown')}</span>
            </button>
            <div className="mx-2 my-1 h-px bg-border" />
            <button
              ref={!canMoveUp && !canMoveDown ? firstMenuItemRef : undefined}
              type="button"
              role="menuitem"
              onClick={() => deleteFromMenu(index)}
              className={menuItemClassName(false, true)}
            >
              <Trash2 className="h-4 w-4 flex-shrink-0" aria-hidden />
              <span>{t('chat.activityMessages.delete')}</span>
            </button>
          </ContextMenuOverlay>
        );
      })()}

      <Dialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
        <DialogContent
          aria-labelledby={resetTitleId}
          aria-describedby={resetDescriptionId}
          wrapperClassName="z-[10000]"
          className="w-[calc(100vw-2rem)] max-w-sm p-6"
        >
          <h2 id={resetTitleId} className="text-lg font-semibold text-foreground">
            {t('chat.activityMessages.resetTitle')}
          </h2>
          <p id={resetDescriptionId} className="mt-2 text-sm text-muted-foreground">
            {t('chat.activityMessages.resetDescription')}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setIsResetConfirmOpen(false)}
            >
              {t('chat.activityMessages.cancel')}
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              onClick={() => {
                onReset();
                setIsResetConfirmOpen(false);
              }}
            >
              {t('chat.activityMessages.resetConfirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
