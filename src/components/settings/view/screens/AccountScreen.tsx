import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../../auth';
import AccountAvatar from '../../../auth/view/AccountAvatar';
import { fileToAvatarDataUrl } from '../../../auth/avatar';
import { Button } from '../../../../shared/view/ui';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsTextField } from '../primitives';

/** What the last save of a section reported, so each one owns its own message. */
type SectionFeedback = { tone: 'success' | 'error'; message: string } | null;

function FeedbackLine({ feedback }: { feedback: SectionFeedback }) {
  if (!feedback) {
    return null;
  }

  return (
    <div className="px-4 pb-4">
      <span className={`text-xs ${feedback.tone === 'success' ? 'text-primary' : 'text-destructive'}`}>
        {feedback.message}
      </span>
    </div>
  );
}

/**
 * The account itself: picture, name, password.
 *
 * Each of the three saves independently and reports separately, because they
 * fail for unrelated reasons — a taken username says nothing about whether the
 * picture uploaded. A single screen-level status line would have to pick one
 * of those to show.
 *
 * Username follows the git-identity save-on-blur model already used on the
 * Projects & Git screen. Password does not: it is three fields that only make
 * sense together, and a blur-triggered credential change is a trap.
 */
export default function AccountScreen() {
  const { t } = useTranslation('settings');
  const { user, updateProfile, changePassword } = useAuth();

  const [username, setUsername] = useState(user?.username ?? '');
  const [usernameFeedback, setUsernameFeedback] = useState<SectionFeedback>(null);

  const [avatarFeedback, setAvatarFeedback] = useState<SectionFeedback>(null);
  const [isAvatarSaving, setIsAvatarSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<SectionFeedback>(null);

  // The context is the source of truth for the stored name; adopt it whenever
  // it changes so a rejected rename snaps back rather than leaving the field
  // showing something the server never accepted.
  useEffect(() => {
    setUsername(user?.username ?? '');
  }, [user?.username]);

  const handleUsernameBlur = async () => {
    const trimmed = username.trim();
    if (!user || trimmed === user.username) {
      setUsername(user?.username ?? '');
      return;
    }

    const result = await updateProfile({ username: trimmed });
    setUsernameFeedback(
      result.success
        ? { tone: 'success', message: t('accountScreen.username.saved') }
        : { tone: 'error', message: result.error },
    );
  };

  const handleAvatarPicked = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    setIsAvatarSaving(true);
    setAvatarFeedback(null);
    try {
      const result = await updateProfile({ avatar: await fileToAvatarDataUrl(file) });
      setAvatarFeedback(
        result.success
          ? { tone: 'success', message: t('accountScreen.picture.saved') }
          : { tone: 'error', message: result.error },
      );
    } catch (error) {
      setAvatarFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : t('accountScreen.picture.failed'),
      });
    } finally {
      setIsAvatarSaving(false);
      // Clear the input so re-picking the same file fires `change` again.
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAvatarRemoved = async () => {
    setIsAvatarSaving(true);
    const result = await updateProfile({ avatar: null });
    setIsAvatarSaving(false);
    setAvatarFeedback(
      result.success
        ? { tone: 'success', message: t('accountScreen.picture.removed') }
        : { tone: 'error', message: result.error },
    );
  };

  const handlePasswordSave = async () => {
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ tone: 'error', message: t('accountScreen.password.mismatch') });
      return;
    }

    setIsPasswordSaving(true);
    const result = await changePassword(currentPassword, newPassword);
    setIsPasswordSaving(false);

    if (!result.success) {
      setPasswordFeedback({ tone: 'error', message: result.error });
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordFeedback({ tone: 'success', message: t('accountScreen.password.saved') });
  };

  const canSavePassword = Boolean(currentPassword && newPassword && confirmPassword) && !isPasswordSaving;

  return (
    <SettingsScreen>
      <SettingsGroup title={t('accountScreen.picture.title')} description={t('accountScreen.picture.description')}>
        <div className="flex items-center gap-4 px-4 py-4">
          <AccountAvatar
            avatar={user?.avatar}
            username={user?.username ?? ''}
            className="h-16 w-16 text-xl"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isAvatarSaving}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('accountScreen.picture.change')}
            </Button>
            {user?.avatar && (
              <Button variant="ghost" size="sm" disabled={isAvatarSaving} onClick={handleAvatarRemoved}>
                {t('accountScreen.picture.remove')}
              </Button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleAvatarPicked(event.target.files?.[0])}
          />
        </div>
        <FeedbackLine feedback={avatarFeedback} />
      </SettingsGroup>

      <SettingsGroup title={t('accountScreen.username.title')}>
        <SettingsRow stacked label={t('accountScreen.username.label')} description={t('accountScreen.username.help')}>
          <SettingsTextField
            value={username}
            onChange={setUsername}
            onBlur={() => void handleUsernameBlur()}
            autoComplete="username"
            ariaLabel={t('accountScreen.username.label')}
          />
        </SettingsRow>
        <FeedbackLine feedback={usernameFeedback} />
      </SettingsGroup>

      <SettingsGroup
        title={t('accountScreen.password.title')}
        description={t('accountScreen.password.description')}
        divided
      >
        <SettingsRow stacked label={t('accountScreen.password.current')}>
          <SettingsTextField
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            ariaLabel={t('accountScreen.password.current')}
          />
        </SettingsRow>
        <SettingsRow stacked label={t('accountScreen.password.new')} description={t('accountScreen.password.help')}>
          <SettingsTextField
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            ariaLabel={t('accountScreen.password.new')}
          />
        </SettingsRow>
        <SettingsRow stacked label={t('accountScreen.password.confirm')}>
          <SettingsTextField
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            ariaLabel={t('accountScreen.password.confirm')}
          />
        </SettingsRow>
        <div className="px-4 pb-4">
          <Button size="sm" disabled={!canSavePassword} onClick={() => void handlePasswordSave()}>
            {t('accountScreen.password.save')}
          </Button>
        </div>
        <FeedbackLine feedback={passwordFeedback} />
      </SettingsGroup>
    </SettingsScreen>
  );
}
