import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createAuthService } from '../auth.service.js';

type AuthDependencies = Parameters<typeof createAuthService>[0];

/**
 * `users` merges rather than replaces, so a test naming one persistence call
 * does not have to restate the other nine. Every other group is small enough to
 * override whole.
 */
type DependencyOverrides = Partial<Omit<AuthDependencies, 'users'>> & {
  users?: Partial<AuthDependencies['users']>;
};

function createDependencies(overrides: DependencyOverrides = {}): AuthDependencies {
  const users: AuthDependencies['users'] = {
    hasUsers: () => false,
    createUser: (username, passwordHash) => ({ id: 1, username, password_hash: passwordHash }),
    getUserByUsername: () => undefined,
    updateLastLogin: () => undefined,
    getUserById: (userId) => ({ id: userId, username: 'alice', avatar: null }),
    updateUsername: () => undefined,
    updateAvatar: () => undefined,
    getPasswordHashById: () => 'stored-hash',
    updatePasswordHash: () => undefined,
    ...overrides.users,
  };

  return {
    transaction: {
      begin: () => undefined,
      commit: () => undefined,
      rollback: () => undefined,
    },
    hashPassword: async () => 'hashed-password',
    comparePassword: async () => false,
    generateToken: () => 'signed-token',
    ...overrides,
    users,
  };
}

test('register hashes credentials and commits through injected dependencies', async () => {
  const operations: string[] = [];
  const service = createAuthService(createDependencies({
    transaction: {
      begin: () => operations.push('begin'),
      commit: () => operations.push('commit'),
      rollback: () => operations.push('rollback'),
    },
    hashPassword: async (password) => {
      operations.push(`hash:${password}`);
      return 'hash';
    },
    users: {
      hasUsers: () => false,
      createUser: (username, passwordHash) => {
        operations.push(`create:${username}:${passwordHash}`);
        return { id: 1, username, password_hash: passwordHash };
      },
      getUserByUsername: () => undefined,
      updateLastLogin: (userId) => operations.push(`login:${userId}`),
    },
  }));

  const result = await service.register('alice', 'secret12');

  assert.equal(result.token, 'signed-token');
  assert.deepEqual(operations, ['begin', 'hash:secret12', 'create:alice:hash', 'commit', 'login:1']);
});

test('login rejects an invalid password without issuing a token', async () => {
  let tokenIssued = false;
  const service = createAuthService(createDependencies({
    users: {
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => ({ id: 1, username: 'alice', password_hash: 'hash' }),
      updateLastLogin: () => undefined,
    },
    comparePassword: async () => false,
    generateToken: () => {
      tokenIssued = true;
      return 'token';
    },
  }));

  await assert.rejects(
    service.login('alice', 'wrong-password'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_INVALID_CREDENTIALS',
  );
  assert.equal(tokenIssued, false);
});

test('refreshSession issues a replacement token for the authenticated user', () => {
  let tokenUser: { id: number | bigint; username: string } | undefined;
  const service = createAuthService(createDependencies({
    generateToken: (user) => {
      tokenUser = user;
      return 'replacement-token';
    },
  }));

  const result = service.refreshSession({ id: 7, username: 'alice' });

  assert.deepEqual(result, { token: 'replacement-token' });
  assert.deepEqual(tokenUser, { id: 7, username: 'alice' });
});

test('updateProfile takes the id from the session, never from the body', () => {
  const renames: string[] = [];
  const service = createAuthService(createDependencies({
    users: {
      updateUsername: (userId, username) => renames.push(`${userId}:${username}`),
    },
  }));

  service.updateProfile(
    { id: 7, username: 'alice' },
    { username: '  renamed  ', id: 999 } as { username?: unknown },
  );

  assert.deepEqual(renames, ['7:renamed']);
});

test('updateProfile leaves the avatar alone unless the key is present', () => {
  const avatarWrites: (string | null)[] = [];
  const dependencies = createDependencies({
    users: {
      updateAvatar: (_userId, avatar) => avatarWrites.push(avatar),
    },
  });

  const service = createAuthService(dependencies);

  service.updateProfile({ id: 1, username: 'alice' }, { username: 'alice2' });
  assert.deepEqual(avatarWrites, [], 'an absent key must not clear the picture');

  service.updateProfile({ id: 1, username: 'alice' }, { avatar: null });
  assert.deepEqual(avatarWrites, [null], 'an explicit null clears it');
});

test('updateProfile rejects anything but a small image data URL', () => {
  const service = createAuthService(createDependencies());

  assert.throws(
    () => service.updateProfile({ id: 1, username: 'alice' }, { avatar: 'https://example.com/a.png' }),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_AVATAR_INVALID',
  );

  assert.throws(
    () => service.updateProfile(
      { id: 1, username: 'alice' },
      { avatar: `data:image/png;base64,${'A'.repeat(300 * 1024)}` },
    ),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_AVATAR_TOO_LARGE',
  );
});

test('changePassword refuses to write when the current password is wrong', async () => {
  const writes: string[] = [];
  const service = createAuthService(createDependencies({
    users: {
      getPasswordHashById: () => 'stored-hash',
      updatePasswordHash: (_userId, hash) => writes.push(hash),
    },
    comparePassword: async () => false,
  }));

  await assert.rejects(
    service.changePassword({ id: 1, username: 'alice' }, 'wrong', 'new-secret'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_INVALID_CREDENTIALS',
  );
  assert.deepEqual(writes, []);
});

test('changePassword stores a hash of the new password, never the password', async () => {
  const writes: string[] = [];
  const service = createAuthService(createDependencies({
    users: {
      updatePasswordHash: (_userId, hash) => writes.push(hash),
    },
    comparePassword: async () => true,
    hashPassword: async (password) => `hashed:${password}`,
  }));

  const result = await service.changePassword({ id: 1, username: 'alice' }, 'old-secret', 'new-secret');

  assert.deepEqual(result, { success: true });
  assert.deepEqual(writes, ['hashed:new-secret']);
});

test('changePassword enforces the same minimum length as registration', async () => {
  const service = createAuthService(createDependencies({ comparePassword: async () => true }));

  await assert.rejects(
    service.changePassword({ id: 1, username: 'alice' }, 'old-secret', 'short'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_CREDENTIALS_TOO_SHORT',
  );
});
