import { useState } from 'react';
import { BellOff, BellRing, Loader2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import {
  getNotificationSoundVolume,
  playChatCompletionSound,
  setNotificationSoundVolume,
} from '../../../../utils/notificationSound';
import type { NotificationPreferencesState } from '../../types/types';
import { CLAUDE_NOTIFICATION_ROWS } from '../../utils/claudeSettingsLayout';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsToggle } from '../primitives';
import ClaudeSettingsGroup from '../sections/agent/ClaudeSettingsGroup';

// Android installs the app with pop-ups off; only its own settings can turn them on.
const IS_ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

type NotificationsScreenProps = {
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  pushPermission: NotificationPermission | 'unsupported';
  isPushSubscribed: boolean;
  isPushLoading: boolean;
  onEnablePush: () => void;
  onDisablePush: () => void;
};

export default function NotificationsScreen({
  notificationPreferences,
  onNotificationPreferencesChange,
  pushPermission,
  isPushSubscribed,
  isPushLoading,
  onEnablePush,
  onDisablePush,
}: NotificationsScreenProps) {
  const { t } = useTranslation('settings');
  const [soundVolume, setSoundVolume] = useState(getNotificationSoundVolume);

  const commitSoundVolume = (value: number) => {
    setNotificationSoundVolume(value);
    void playChatCompletionSound({ force: true });
  };

  const pushSupported = pushPermission !== 'unsupported';
  const pushDenied = pushPermission === 'denied';

  const setChannel = (key: keyof NotificationPreferencesState['channels'], value: boolean) => {
    onNotificationPreferencesChange({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, [key]: value },
    });
  };

  const setEvent = (key: keyof NotificationPreferencesState['events'], value: boolean) => {
    onNotificationPreferencesChange({
      ...notificationPreferences,
      events: { ...notificationPreferences.events, [key]: value },
    });
  };

  return (
    <SettingsScreen description={t('notifications.description')}>
      <SettingsGroup title={t('notifications.webPush.title')}>
        {!pushSupported ? (
          <p className="p-4 text-sm text-muted-foreground">{t('notifications.webPush.unsupported')}</p>
        ) : pushDenied ? (
          <p className="p-4 text-sm text-muted-foreground">{t('notifications.webPush.denied')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3 p-4">
            <Button
              type="button"
              size="sm"
              variant={isPushSubscribed ? 'destructive' : 'default'}
              disabled={isPushLoading}
              onClick={() => (isPushSubscribed ? onDisablePush() : onEnablePush())}
            >
              {isPushLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isPushSubscribed ? (
                <BellOff className="h-4 w-4" />
              ) : (
                <BellRing className="h-4 w-4" />
              )}
              {isPushLoading
                ? t('notifications.webPush.loading')
                : isPushSubscribed
                  ? t('notifications.webPush.disable')
                  : t('notifications.webPush.enable')}
            </Button>
            {isPushSubscribed && (
              <span className="text-sm text-primary">{t('notifications.webPush.enabled')}</span>
            )}
            {isPushSubscribed && IS_ANDROID && (
              <p className="w-full text-sm text-muted-foreground">{t('notifications.webPush.popupHint')}</p>
            )}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup divided>
        <SettingsRow label={t('notifications.sound.title')} description={t('notifications.sound.description')}>
          <SettingsToggle
            checked={notificationPreferences.channels.sound}
            onChange={(value) => setChannel('sound', value)}
            ariaLabel={t('notifications.sound.title')}
          />
        </SettingsRow>
        <SettingsRow stacked label={t('notifications.sound.volume')}>
          <div className="flex w-full items-center gap-2">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={soundVolume}
              onChange={(event) => setSoundVolume(Number(event.target.value))}
              onPointerUp={(event) => commitSoundVolume(Number(event.currentTarget.value))}
              onKeyUp={(event) => commitSoundVolume(Number(event.currentTarget.value))}
              aria-label={t('notifications.sound.volume')}
              className="h-11 min-w-12 flex-1 touch-manipulation accent-primary"
            />
            <output className="w-12 text-right text-sm font-medium tabular-nums text-foreground">
              {soundVolume}%
            </output>
          </div>
        </SettingsRow>
        <div className="p-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void playChatCompletionSound({ force: true });
            }}
          >
            <Play className="h-4 w-4" />
            {t('notifications.sound.test')}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('notifications.events.title')} divided>
        <SettingsRow label={t('notifications.events.actionRequired')}>
          <SettingsToggle
            checked={notificationPreferences.events.actionRequired}
            onChange={(value) => setEvent('actionRequired', value)}
            ariaLabel={t('notifications.events.actionRequired')}
          />
        </SettingsRow>
        <SettingsRow label={t('notifications.events.stop')}>
          <SettingsToggle
            checked={notificationPreferences.events.stop}
            onChange={(value) => setEvent('stop', value)}
            ariaLabel={t('notifications.events.stop')}
          />
        </SettingsRow>
        <SettingsRow label={t('notifications.events.error')}>
          <SettingsToggle
            checked={notificationPreferences.events.error}
            onChange={(value) => setEvent('error', value)}
            ariaLabel={t('notifications.events.error')}
          />
        </SettingsRow>
      </SettingsGroup>

      <ClaudeSettingsGroup
        rows={CLAUDE_NOTIFICATION_ROWS}
        title={t('claudeSettings.sections.claudeApp')}
        description={t('claudeSettings.sections.claudeAppDescription')}
      />
    </SettingsScreen>
  );
}
