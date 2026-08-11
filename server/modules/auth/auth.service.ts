import { AppError } from '@/shared/utils.js';

type AuthUser = {
  id: number | bigint;
  username: string;
};

type AuthLoginUser = AuthUser & { password_hash: string };

type AuthPublicUser = AuthUser & { avatar?: string | null };

type AuthDependencies = {
  users: {
    hasUsers(): boolean;
    createUser(username: string, passwordHash: string): AuthUser;
    getUserByUsername(username: string): AuthLoginUser | undefined;
    updateLastLogin(userId: number): void;
    getUserById(userId: number): AuthPublicUser | undefined;
    updateUsername(userId: number, username: string): void;
    updateAvatar(userId: number, avatar: string | null): void;
    getPasswordHashById(userId: number): string | undefined;
    updatePasswordHash(userId: number, passwordHash: string): void;
  };
  transaction: {
    begin(): void;
    commit(): void;
    rollback(): void;
  };
  hashPassword(password: string): Promise<string>;
  comparePassword(password: string, passwordHash: string): Promise<boolean>;
  generateToken(user: AuthUser): string;
};

const MIN_USERNAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 6;

/**
 * Roughly 256 KB of base64. The client downscales to a 256px square before
 * uploading, which lands in the tens of kilobytes, so this exists only to stop
 * a hand-rolled request from parking a full photo in a column that rides along
 * with every `/api/auth/user` response.
 */
const MAX_AVATAR_LENGTH = 256 * 1024;
const AVATAR_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

function numericUserId(userId: number | bigint): number {
  return Number(userId);
}

/**
 * Narrows the value `authenticateToken` put on the request. Every mutating
 * account route needs the id, and none of them should trust the caller's body
 * for it.
 */
function requireAuthenticatedUser(user: unknown): AuthUser {
  if (
    typeof user !== 'object'
    || user === null
    || !('id' in user)
    || !('username' in user)
    || (typeof user.id !== 'number' && typeof user.id !== 'bigint')
    || typeof user.username !== 'string'
  ) {
    throw new AppError('Authenticated user is required', {
      code: 'AUTH_USER_REQUIRED',
      statusCode: 401,
    });
  }

  return user as AuthUser;
}

/** `null` clears the picture; anything else must be a small image data URL. */
function normalizeAvatar(input: unknown): string | null {
  if (input === null || input === '') {
    return null;
  }

  if (typeof input !== 'string' || !AVATAR_DATA_URL_PATTERN.test(input)) {
    throw new AppError('Avatar must be a PNG, JPEG, or WebP data URL', {
      code: 'AUTH_AVATAR_INVALID',
      statusCode: 400,
    });
  }

  if (input.length > MAX_AVATAR_LENGTH) {
    throw new AppError('Avatar image is too large', {
      code: 'AUTH_AVATAR_TOO_LARGE',
      statusCode: 413,
    });
  }

  return input;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Creates the Auth application service around explicit persistence, crypto,
 * transaction, and token dependencies.
 */
export function createAuthService(dependencies: AuthDependencies) {
  return {
    getStatus() {
      return {
        needsSetup: !dependencies.users.hasUsers(),
        isAuthenticated: false,
      };
    },

    async register(usernameInput: unknown, passwordInput: unknown) {
      const username = typeof usernameInput === 'string' ? usernameInput : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';

      if (!username || !password) {
        throw new AppError('Username and password are required', {
          code: 'AUTH_CREDENTIALS_REQUIRED',
          statusCode: 400,
        });
      }
      if (username.length < MIN_USERNAME_LENGTH || password.length < MIN_PASSWORD_LENGTH) {
        throw new AppError(
          'Username must be at least 3 characters, password at least 6 characters',
          { code: 'AUTH_CREDENTIALS_TOO_SHORT', statusCode: 400 },
        );
      }

      dependencies.transaction.begin();
      try {
        if (dependencies.users.hasUsers()) {
          throw new AppError('User already exists. This is a single-user system.', {
            code: 'AUTH_USER_ALREADY_CONFIGURED',
            statusCode: 403,
          });
        }

        const passwordHash = await dependencies.hashPassword(password);
        const user = dependencies.users.createUser(username, passwordHash);
        const token = dependencies.generateToken(user);
        dependencies.transaction.commit();
        dependencies.users.updateLastLogin(numericUserId(user.id));

        return {
          success: true,
          user: { id: user.id, username: user.username },
          token,
        };
      } catch (error) {
        dependencies.transaction.rollback();
        if (isUniqueConstraintError(error)) {
          throw new AppError('Username already exists', {
            code: 'AUTH_USERNAME_CONFLICT',
            statusCode: 409,
          });
        }
        throw error;
      }
    },

    async login(usernameInput: unknown, passwordInput: unknown) {
      const username = typeof usernameInput === 'string' ? usernameInput : '';
      const password = typeof passwordInput === 'string' ? passwordInput : '';
      if (!username || !password) {
        throw new AppError('Username and password are required', {
          code: 'AUTH_CREDENTIALS_REQUIRED',
          statusCode: 400,
        });
      }

      const user = dependencies.users.getUserByUsername(username);
      const validPassword = user
        ? await dependencies.comparePassword(password, user.password_hash)
        : false;
      if (!user || !validPassword) {
        throw new AppError('Invalid username or password', {
          code: 'AUTH_INVALID_CREDENTIALS',
          statusCode: 401,
        });
      }

      dependencies.users.updateLastLogin(numericUserId(user.id));
      return {
        success: true,
        user: { id: user.id, username: user.username },
        token: dependencies.generateToken(user),
      };
    },

    getCurrentUser(user: unknown) {
      return { user };
    },

    refreshSession(user: unknown) {
      return { token: dependencies.generateToken(requireAuthenticatedUser(user)) };
    },

    /**
     * Renames the account, replaces its picture, or both.
     *
     * Each field is optional so the Account screen's two controls save
     * independently: an absent key means "leave it", and `avatar: null` means
     * "remove it". Returns the stored row so the caller never has to guess what
     * the server actually kept.
     *
     * The JWT carries the username it was minted with, and a rename does not
     * re-issue it. That is safe because nothing authenticates on that claim —
     * both `authenticateToken` and `authenticateWebSocket` look the user up by
     * `userId` and hand back the database row.
     */
    updateProfile(user: unknown, body: { username?: unknown; avatar?: unknown }) {
      const userId = numericUserId(requireAuthenticatedUser(user).id);

      if (typeof body.username === 'string') {
        const username = body.username.trim();
        if (username.length < MIN_USERNAME_LENGTH) {
          throw new AppError(
            `Username must be at least ${MIN_USERNAME_LENGTH} characters`,
            { code: 'AUTH_CREDENTIALS_TOO_SHORT', statusCode: 400 },
          );
        }

        try {
          dependencies.users.updateUsername(userId, username);
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            throw new AppError('Username already exists', {
              code: 'AUTH_USERNAME_CONFLICT',
              statusCode: 409,
            });
          }
          throw error;
        }
      }

      // `in` rather than a truthiness check: null is the documented way to
      // clear the picture, and would be skipped by anything looser.
      if ('avatar' in body) {
        dependencies.users.updateAvatar(userId, normalizeAvatar(body.avatar));
      }

      const updated = dependencies.users.getUserById(userId);
      if (!updated) {
        throw new AppError('Authenticated user is required', {
          code: 'AUTH_USER_REQUIRED',
          statusCode: 401,
        });
      }

      return { success: true, user: updated };
    },

    /**
     * Replaces the password after verifying the current one.
     *
     * Deliberately does not invalidate outstanding tokens: there is no
     * revocation list, so pretending otherwise would be worse than being clear
     * that a password change is a credential update, not a session reset.
     */
    async changePassword(
      user: unknown,
      currentPasswordInput: unknown,
      newPasswordInput: unknown,
    ) {
      const userId = numericUserId(requireAuthenticatedUser(user).id);
      const currentPassword = typeof currentPasswordInput === 'string' ? currentPasswordInput : '';
      const newPassword = typeof newPasswordInput === 'string' ? newPasswordInput : '';

      if (!currentPassword || !newPassword) {
        throw new AppError('Current and new passwords are required', {
          code: 'AUTH_CREDENTIALS_REQUIRED',
          statusCode: 400,
        });
      }

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        throw new AppError(
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
          { code: 'AUTH_CREDENTIALS_TOO_SHORT', statusCode: 400 },
        );
      }

      const passwordHash = dependencies.users.getPasswordHashById(userId);
      const isCurrentPasswordValid = passwordHash
        ? await dependencies.comparePassword(currentPassword, passwordHash)
        : false;

      if (!isCurrentPasswordValid) {
        throw new AppError('Current password is incorrect', {
          code: 'AUTH_INVALID_CREDENTIALS',
          statusCode: 401,
        });
      }

      dependencies.users.updatePasswordHash(userId, await dependencies.hashPassword(newPassword));

      return { success: true };
    },

    logout() {
      return { success: true, message: 'Logged out successfully' };
    },
  };
}
