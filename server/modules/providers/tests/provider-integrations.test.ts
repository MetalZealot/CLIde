import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import TOML from '@iarna/toml';

import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { createProviderServiceStatusService } from '@/modules/providers/services/provider-service-status.service.js';
import { providerSkillsService } from '@/modules/providers/services/skills.service.js';
import { AppError } from '@/shared/utils.js';

describe('mcp', () => {
  const patchHomeDir = (nextHomeDir: string) => {
    const original = os.homedir;
    (os as any).homedir = () => nextHomeDir;
    return () => {
      (os as any).homedir = original;
    };
  };

  const readJson = async (filePath: string): Promise<Record<string, unknown>> => {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as Record<string, unknown>;
  };

  /**
   * This test covers Claude MCP support for all scopes (user/local/project) and all transports (stdio/http/sse),
   * including add, update/list, and remove operations.
   */
  test('providerMcpService handles claude MCP scopes/transports with file-backed persistence', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-claude-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      await providerMcpService.upsertProviderMcpServer('claude', {
        name: 'claude-user-stdio',
        scope: 'user',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'my-server'],
        env: { API_KEY: 'secret' },
      });

      await providerMcpService.upsertProviderMcpServer('claude', {
        name: 'claude-local-http',
        scope: 'local',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
        workspacePath,
      });

      await providerMcpService.upsertProviderMcpServer('claude', {
        name: 'claude-project-sse',
        scope: 'project',
        transport: 'sse',
        url: 'https://example.com/sse',
        headers: { 'X-API-Key': 'abc' },
        workspacePath,
      });

      const grouped = await providerMcpService.listProviderMcpServers('claude', { workspacePath });
      assert.ok(grouped.user.some((server) => server.name === 'claude-user-stdio' && server.transport === 'stdio'));
      assert.ok(grouped.local.some((server) => server.name === 'claude-local-http' && server.transport === 'http'));
      assert.ok(grouped.project.some((server) => server.name === 'claude-project-sse' && server.transport === 'sse'));

      // update behavior is the same upsert route with same name
      await providerMcpService.upsertProviderMcpServer('claude', {
        name: 'claude-project-sse',
        scope: 'project',
        transport: 'sse',
        url: 'https://example.com/sse-updated',
        headers: { 'X-API-Key': 'updated' },
        workspacePath,
      });

      const projectConfig = await readJson(path.join(workspacePath, '.mcp.json'));
      const projectServers = projectConfig.mcpServers as Record<string, unknown>;
      const projectServer = projectServers['claude-project-sse'] as Record<string, unknown>;
      assert.equal(projectServer.url, 'https://example.com/sse-updated');

      const removeResult = await providerMcpService.removeProviderMcpServer('claude', {
        name: 'claude-local-http',
        scope: 'local',
        workspacePath,
      });
      assert.equal(removeResult.removed, true);
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers Codex MCP support for user/project scopes, stdio/http formats,
   * and validation for unsupported scope/transport combinations.
   */
  test('providerMcpService handles codex MCP TOML config and capability validation', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-codex-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      await providerMcpService.upsertProviderMcpServer('codex', {
        name: 'codex-user-stdio',
        scope: 'user',
        transport: 'stdio',
        command: 'python',
        args: ['server.py'],
        env: { API_KEY: 'x' },
        envVars: ['API_KEY'],
        cwd: '/tmp',
      });

      const userTomlPath = path.join(tempRoot, '.codex', 'config.toml');
      const userConfig = TOML.parse(await fs.readFile(userTomlPath, 'utf8')) as Record<string, unknown>;
      const userServers = userConfig.mcp_servers as Record<string, unknown>;
      const userStdio = userServers['codex-user-stdio'] as Record<string, unknown>;
      assert.equal(userStdio.command, 'python');

      const projectTomlPath = path.join(workspacePath, '.codex', 'config.toml');
      await fs.mkdir(path.dirname(projectTomlPath), { recursive: true });
      await fs.writeFile(
        projectTomlPath,
        TOML.stringify({
          mcp_servers: {
            'codex-project-http': {
              url: 'https://codex.example.com/mcp',
              http_headers: { 'X-Custom-Header': 'value' },
              omit_tools_from: ['native-tool'],
            },
          },
        } as never),
        'utf8',
      );

      const listed = await providerMcpService.listProviderMcpServers('codex', { workspacePath });
      assert.ok(listed.project.some((server) => (
        server.name === 'codex-project-http' && server.url === 'https://codex.example.com/mcp'
      )));

      await providerMcpService.upsertProviderMcpServer('codex', {
        name: 'codex-project-http',
        scope: 'project',
        transport: 'http',
        url: 'https://codex.example.com/mcp-updated',
        headers: { 'X-Custom-Header': 'updated' },
        envHttpHeaders: { 'X-API-Key': 'MY_API_KEY_ENV' },
        bearerTokenEnvVar: 'MY_API_TOKEN',
        workspacePath,
      });

      const projectConfig = TOML.parse(await fs.readFile(projectTomlPath, 'utf8')) as Record<string, unknown>;
      const projectServers = projectConfig.mcp_servers as Record<string, unknown>;
      const projectHttp = projectServers['codex-project-http'] as Record<string, unknown>;
      assert.equal(projectHttp.url, 'https://codex.example.com/mcp-updated');
      assert.deepEqual(projectHttp.omit_tools_from, ['native-tool']);

      await assert.rejects(
        providerMcpService.upsertProviderMcpServer('codex', {
          name: 'codex-local',
          scope: 'local',
          transport: 'stdio',
          command: 'node',
        }),
        (error: unknown) =>
          error instanceof AppError &&
          error.code === 'MCP_SCOPE_NOT_SUPPORTED' &&
          error.statusCode === 400,
      );

      await assert.rejects(
        providerMcpService.upsertProviderMcpServer('codex', {
          name: 'codex-sse',
          scope: 'project',
          transport: 'sse',
          url: 'https://example.com/sse',
          workspacePath,
        }),
        (error: unknown) =>
          error instanceof AppError &&
          error.code === 'MCP_TRANSPORT_NOT_SUPPORTED' &&
          error.statusCode === 400,
      );
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers OpenCode MCP support for user/project config files, JSONC-compatible
   * reads, and validation for unsupported scope/transport combinations.
   */
  test('providerMcpService handles opencode MCP config and capability validation', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-opencode-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(path.join(tempRoot, '.config', 'opencode'), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, '.config', 'opencode', 'opencode.jsonc'),
      `{
        // Existing comments should not block OpenCode MCP reads.
        "mcp": {}
      }\n`,
      'utf8',
    );

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      await providerMcpService.upsertProviderMcpServer('opencode', {
        name: 'opencode-user-stdio',
        scope: 'user',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'x' },
      });

      await providerMcpService.upsertProviderMcpServer('opencode', {
        name: 'opencode-project-http',
        scope: 'project',
        transport: 'http',
        url: 'https://opencode.example.com/mcp',
        headers: { Authorization: 'Bearer token' },
        workspacePath,
      });

      const userConfig = await readJson(path.join(tempRoot, '.config', 'opencode', 'opencode.jsonc'));
      const userServers = userConfig.mcp as Record<string, unknown>;
      const userStdio = userServers['opencode-user-stdio'] as Record<string, unknown>;
      assert.equal(userStdio.type, 'local');
      assert.deepEqual(userStdio.command, ['node', 'server.js']);
      assert.deepEqual(userStdio.environment, { API_KEY: 'x' });

      const projectConfig = await readJson(path.join(workspacePath, 'opencode.json'));
      const projectServers = projectConfig.mcp as Record<string, unknown>;
      const projectHttp = projectServers['opencode-project-http'] as Record<string, unknown>;
      assert.equal(projectHttp.type, 'remote');
      assert.equal(projectHttp.url, 'https://opencode.example.com/mcp');

      const grouped = await providerMcpService.listProviderMcpServers('opencode', { workspacePath });
      assert.ok(grouped.user.some((server) => server.name === 'opencode-user-stdio' && server.transport === 'stdio'));
      assert.ok(grouped.project.some((server) => server.name === 'opencode-project-http' && server.transport === 'http'));

      await assert.rejects(
        providerMcpService.upsertProviderMcpServer('opencode', {
          name: 'opencode-local',
          scope: 'local',
          transport: 'stdio',
          command: 'node',
        }),
        (error: unknown) =>
          error instanceof AppError &&
          error.code === 'MCP_SCOPE_NOT_SUPPORTED' &&
          error.statusCode === 400,
      );

      await assert.rejects(
        providerMcpService.upsertProviderMcpServer('opencode', {
          name: 'opencode-sse',
          scope: 'project',
          transport: 'sse',
          url: 'https://example.com/sse',
          workspacePath,
        }),
        (error: unknown) =>
          error instanceof AppError &&
          error.code === 'MCP_TRANSPORT_NOT_SUPPORTED' &&
          error.statusCode === 400,
      );
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers Cursor MCP JSON format and user/project scope persistence.
   */
  test('providerMcpService handles cursor MCP JSON config formats', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-gc-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      await providerMcpService.upsertProviderMcpServer('cursor', {
        name: 'cursor-stdio',
        scope: 'project',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'mcp-server'],
        env: { API_KEY: 'value' },
        workspacePath,
      });

      await providerMcpService.upsertProviderMcpServer('cursor', {
        name: 'cursor-http',
        scope: 'user',
        transport: 'http',
        url: 'http://localhost:3333/mcp',
        headers: { API_KEY: 'value' },
      });

      const cursorUserConfig = await readJson(path.join(tempRoot, '.cursor', 'mcp.json'));
      const cursorHttpServer = (cursorUserConfig.mcpServers as Record<string, unknown>)['cursor-http'] as Record<string, unknown>;
      assert.equal(cursorHttpServer.url, 'http://localhost:3333/mcp');
      assert.equal(cursorHttpServer.type, undefined);
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers the global MCP adder requirement: only http/stdio are allowed and
   * one payload is written to all providers.
   */
  test('providerMcpService global adder writes to all providers and rejects unsupported transports', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-mcp-global-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      const globalResult = await providerMcpService.addMcpServerToAllProviders({
        name: 'global-http',
        scope: 'project',
        transport: 'http',
        url: 'https://global.example.com/mcp',
        workspacePath,
      });

      assert.equal(globalResult.length, 4);
      assert.ok(globalResult.every((entry) => entry.created === true));

      const claudeProject = await readJson(path.join(workspacePath, '.mcp.json'));
      assert.ok((claudeProject.mcpServers as Record<string, unknown>)['global-http']);

      const codexProject = TOML.parse(await fs.readFile(path.join(workspacePath, '.codex', 'config.toml'), 'utf8')) as Record<string, unknown>;
      assert.ok((codexProject.mcp_servers as Record<string, unknown>)['global-http']);

      const opencodeProject = await readJson(path.join(workspacePath, 'opencode.json'));
      assert.ok((opencodeProject.mcp as Record<string, unknown>)['global-http']);

      const cursorProject = await readJson(path.join(workspacePath, '.cursor', 'mcp.json'));
      assert.ok((cursorProject.mcpServers as Record<string, unknown>)['global-http']);

      await assert.rejects(
        providerMcpService.addMcpServerToAllProviders({
          name: 'global-sse',
          scope: 'project',
          transport: 'sse',
          url: 'https://example.com/sse',
          workspacePath,
        }),
        (error: unknown) =>
          error instanceof AppError &&
          error.code === 'INVALID_GLOBAL_MCP_TRANSPORT' &&
          error.statusCode === 400,
      );
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('skills', () => {
  const patchHomeDir = (nextHomeDir: string) => {
    const original = os.homedir;
    (os as any).homedir = () => nextHomeDir;
    return () => {
      (os as any).homedir = original;
    };
  };

  const writeSkill = async (
    skillsRoot: string,
    directoryName: string,
    name: string,
    description: string,
  ): Promise<string> => {
    const skillDir = path.join(skillsRoot, directoryName);
    await fs.mkdir(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(
      skillPath,
      `---\nname: ${name}\ndescription: ${description}\n---\n\n`,
      'utf8',
    );
    return skillPath;
  };

  const writeClaudePluginManifest = async (
    installPath: string,
    name: string,
  ): Promise<void> => {
    const pluginConfigDir = path.join(installPath, '.claude-plugin');
    await fs.mkdir(pluginConfigDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginConfigDir, 'plugin.json'),
      JSON.stringify(
        {
          name,
          version: '0.1.0',
          description: `${name} test plugin`,
        },
        null,
        2,
      ),
      'utf8',
    );
  };

  const writeClaudePluginCommand = async (
    commandsRoot: string,
    commandName: string,
    description: string,
  ): Promise<string> => {
    await fs.mkdir(commandsRoot, { recursive: true });
    const commandPath = path.join(commandsRoot, `${commandName}.md`);
    await fs.writeFile(
      commandPath,
      `---\ndescription: ${description}\nargument-hint: 'test args'\n---\n\nCommand body.\n`,
      'utf8',
    );
    return commandPath;
  };

  /**
   * This test covers Claude user/project skill folders plus plugin discovery from
   * installed plugin command files and fallback plugin skill files.
   */
  test('providerSkillsService lists claude user, synced, project, and enabled plugin skills', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-claude-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    const commandPluginInstallPath = path.join(
      tempRoot,
      '.claude',
      'plugins',
      'cache',
      'notion-plugin',
      'notion',
      'abc123',
    );
    const skillPluginInstallPath = path.join(
      tempRoot,
      '.claude',
      'plugins',
      'cache',
      'anthropic-agent-skills',
      'example-skills',
      'def456',
    );
    const disabledPluginInstallPath = path.join(
      tempRoot,
      '.claude',
      'plugins',
      'cache',
      'disabled-marketplace',
      'disabled-skills',
      'ghi789',
    );
    const emptyIdPluginInstallPath = path.join(
      tempRoot,
      '.claude',
      'plugins',
      'cache',
      'invalid-empty-plugin',
      'empty',
      '000',
    );
    const atIdPluginInstallPath = path.join(
      tempRoot,
      '.claude',
      'plugins',
      'cache',
      'invalid-at-plugin',
      'at',
      '000',
    );
    const siblingSkillPluginPath = path.join(path.dirname(skillPluginInstallPath), 'legacy777');
    await fs.mkdir(workspacePath, { recursive: true });

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      await writeSkill(
        path.join(tempRoot, '.claude', 'skills'),
        'claude-user-dir',
        'claude-user',
        'Claude user skill',
      );
      await writeSkill(
        path.join(tempRoot, '.claude', 'skills', 'synced'),
        'claude-synced-dir',
        'claude-synced',
        'Claude synced skill',
      );
      await writeSkill(
        path.join(tempRoot, '.claude', 'skills', '.trash'),
        'claude-trashed-dir',
        'claude-trashed',
        'Claude trashed skill',
      );
      await writeSkill(
        path.join(workspacePath, '.claude', 'skills'),
        'claude-project-dir',
        'claude-project',
        'Claude project skill',
      );
      await writeClaudePluginManifest(commandPluginInstallPath, 'Notion');
      await writeClaudePluginCommand(
        path.join(commandPluginInstallPath, 'commands'),
        'insert-row',
        'Insert a Notion database row',
      );
      await writeSkill(
        path.join(commandPluginInstallPath, 'skills'),
        'ignored-command-plugin-skill-dir',
        'ignored-command-plugin-skill',
        'Command plugin fallback skill should be ignored',
      );
      await writeClaudePluginManifest(skillPluginInstallPath, 'ExampleSkills');
      await writeSkill(
        path.join(skillPluginInstallPath, 'skills'),
        'claude-plugin-dir',
        'claude-plugin',
        'Claude plugin skill',
      );
      await writeSkill(
        path.join(skillPluginInstallPath, 'skills'),
        'claude-plugin-second-dir',
        'claude-plugin-second',
        'Second Claude plugin skill',
      );
      await writeSkill(
        path.join(skillPluginInstallPath, 'skills', 'nested', 'collection'),
        'claude-plugin-nested-dir',
        'claude-plugin-nested',
        'Nested Claude plugin skill',
      );
      await writeSkill(
        path.join(siblingSkillPluginPath, 'skills'),
        'claude-plugin-sibling-dir',
        'claude-plugin-sibling',
        'Sibling Claude plugin skill',
      );
      await writeClaudePluginManifest(disabledPluginInstallPath, 'DisabledSkills');
      await writeClaudePluginCommand(
        path.join(disabledPluginInstallPath, 'commands'),
        'disabled-command',
        'Disabled plugin command',
      );
      await writeClaudePluginCommand(
        path.join(emptyIdPluginInstallPath, 'commands'),
        'invalid-empty-command',
        'Invalid empty id command',
      );
      await writeClaudePluginCommand(
        path.join(atIdPluginInstallPath, 'commands'),
        'invalid-at-command',
        'Invalid at id command',
      );
      await writeSkill(
        path.join(
          disabledPluginInstallPath,
          'skills',
        ),
        'disabled-plugin-dir',
        'disabled-plugin',
        'Disabled plugin skill',
      );

      await fs.writeFile(
        path.join(tempRoot, '.claude', 'settings.json'),
        JSON.stringify(
          {
            enabledPlugins: {
              '': true,
              '@': true,
              'notion@notion-marketplace': true,
              'example-skills@anthropic-agent-skills': true,
              'disabled-skills@disabled-marketplace': false,
            },
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.writeFile(
        path.join(tempRoot, '.claude', 'plugins', 'installed_plugins.json'),
        JSON.stringify(
          {
            version: 2,
            plugins: {
              '': [
                {
                  scope: 'user',
                  installPath: emptyIdPluginInstallPath,
                  version: '000',
                },
              ],
              '@': [
                {
                  scope: 'user',
                  installPath: atIdPluginInstallPath,
                  version: '000',
                },
              ],
              'notion@notion-marketplace': [
                {
                  scope: 'user',
                  installPath: commandPluginInstallPath,
                  version: 'abc123',
                },
              ],
              'example-skills@anthropic-agent-skills': [
                {
                  scope: 'user',
                  installPath: skillPluginInstallPath,
                  version: 'def456',
                },
              ],
              'disabled-skills@disabled-marketplace': [
                {
                  scope: 'user',
                  installPath: disabledPluginInstallPath,
                  version: 'ghi789',
                },
              ],
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const skills = await providerSkillsService.listProviderSkills('claude', { workspacePath });
      const byName = new Map(skills.map((skill) => [skill.name, skill]));

      assert.equal(byName.get('claude-user')?.scope, 'user');
      assert.equal(byName.get('claude-user')?.command, '/claude-user');
      assert.equal(byName.get('claude-project')?.scope, 'project');
      assert.equal(byName.get('claude-project')?.command, '/claude-project');
      // Synced skills run in the session, so they must also be listed; the
      // sibling trash folder holds skills the account has revoked.
      assert.equal(byName.get('claude-synced')?.scope, 'user');
      assert.equal(byName.get('claude-synced')?.command, '/claude-synced');
      assert.equal(byName.has('claude-trashed'), false);

      const pluginCommand = byName.get('insert-row');
      assert.equal(pluginCommand?.scope, 'plugin');
      assert.equal(pluginCommand?.pluginName, 'Notion');
      assert.equal(pluginCommand?.pluginId, 'notion@notion-marketplace');
      assert.equal(pluginCommand?.command, '/Notion:insert-row');
      assert.equal(pluginCommand?.description, 'Insert a Notion database row');
      assert.match(pluginCommand?.sourcePath ?? '', /commands[\\/]insert-row\.md$/);
      assert.equal(byName.has('ignored-command-plugin-skill'), false);

      const pluginSkill = byName.get('claude-plugin');
      assert.equal(pluginSkill?.scope, 'plugin');
      assert.equal(pluginSkill?.pluginName, 'ExampleSkills');
      assert.equal(pluginSkill?.pluginId, 'example-skills@anthropic-agent-skills');
      assert.equal(pluginSkill?.command, '/ExampleSkills:claude-plugin');
      assert.equal(pluginSkill?.description, 'Claude plugin skill');
      assert.match(
        pluginSkill?.sourcePath ?? '',
        /cache[\\/]anthropic-agent-skills[\\/]example-skills[\\/]def456[\\/]skills[\\/]/,
      );

      const secondPluginSkill = byName.get('claude-plugin-second');
      assert.equal(secondPluginSkill?.scope, 'plugin');
      assert.equal(secondPluginSkill?.command, '/ExampleSkills:claude-plugin-second');

      const nestedPluginSkill = byName.get('claude-plugin-nested');
      assert.equal(nestedPluginSkill?.scope, 'plugin');
      assert.equal(nestedPluginSkill?.command, '/ExampleSkills:claude-plugin-nested');
      assert.equal(nestedPluginSkill?.description, 'Nested Claude plugin skill');

      const siblingPluginSkill = byName.get('claude-plugin-sibling');
      assert.equal(siblingPluginSkill?.scope, 'plugin');
      assert.equal(siblingPluginSkill?.pluginName, 'example-skills');
      assert.equal(siblingPluginSkill?.command, '/example-skills:claude-plugin-sibling');
      assert.equal(siblingPluginSkill?.description, 'Sibling Claude plugin skill');
      assert.equal(byName.has('disabled-command'), false);
      assert.equal(byName.has('disabled-plugin'), false);
      assert.equal(byName.has('invalid-empty-command'), false);
      assert.equal(byName.has('invalid-at-command'), false);
      assert.equal(skills.some((skill) => skill.command.startsWith('/:')), false);
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers Codex repository/user/system skill folders, including both
   * supported user roots, and verifies repository lookup across cwd, parent, and git root.
   */
  test('providerSkillsService lists codex repository, user, and system skills', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-codex-'));
    const repoRoot = path.join(tempRoot, 'repo');
    const workspacePath = path.join(repoRoot, 'packages', 'app');
    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
    await fs.mkdir(workspacePath, { recursive: true });

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      await writeSkill(
        path.join(workspacePath, '.agents', 'skills'),
        'codex-cwd-dir',
        'codex-cwd',
        'Codex cwd skill',
      );
      await writeSkill(
        path.join(repoRoot, 'packages', '.agents', 'skills'),
        'codex-parent-dir',
        'codex-parent',
        'Codex parent skill',
      );
      await writeSkill(
        path.join(repoRoot, '.agents', 'skills'),
        'codex-root-dir',
        'codex-root',
        'Codex root skill',
      );
      await writeSkill(
        path.join(tempRoot, '.agents', 'skills'),
        'codex-user-dir',
        'codex-user',
        'Codex user skill',
      );
      await writeSkill(
        path.join(tempRoot, '.codex', 'skills'),
        'codex-home-user-dir',
        'codex-home-user',
        'Codex home user skill',
      );
      await writeSkill(
        path.join(tempRoot, '.codex', 'skills', '.system'),
        'codex-system-dir',
        'codex-system',
        'Codex system skill',
      );

      const skills = await providerSkillsService.listProviderSkills('codex', { workspacePath });
      const byName = new Map(skills.map((skill) => [skill.name, skill]));

      assert.equal(byName.get('codex-cwd')?.scope, 'repo');
      assert.equal(byName.get('codex-parent')?.scope, 'repo');
      assert.equal(byName.get('codex-root')?.scope, 'repo');
      assert.equal(byName.get('codex-user')?.scope, 'user');
      assert.equal(byName.get('codex-home-user')?.scope, 'user');
      assert.equal(byName.get('codex-system')?.scope, 'system');
      assert.equal(byName.get('codex-root')?.command, '$codex-root');
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers OpenCode skill lookup across cwd-to-git-root project folders
   * plus the global OpenCode/Claude/Agents compatibility locations.
   */
  test('providerSkillsService lists opencode project and user compatibility skills', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-opencode-'));
    const repoRoot = path.join(tempRoot, 'repo');
    const workspacePath = path.join(repoRoot, 'packages', 'app');
    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
    await fs.mkdir(workspacePath, { recursive: true });

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      await writeSkill(
        path.join(workspacePath, '.opencode', 'skills'),
        'opencode-cwd-dir',
        'opencode-cwd',
        'OpenCode cwd skill',
      );
      await writeSkill(
        path.join(repoRoot, 'packages', '.claude', 'skills'),
        'opencode-claude-parent-dir',
        'opencode-claude-parent',
        'OpenCode Claude parent skill',
      );
      await writeSkill(
        path.join(repoRoot, '.agents', 'skills'),
        'opencode-agents-root-dir',
        'opencode-agents-root',
        'OpenCode Agents root skill',
      );
      await writeSkill(
        path.join(tempRoot, '.config', 'opencode', 'skills'),
        'opencode-user-dir',
        'opencode-user',
        'OpenCode user skill',
      );
      await writeSkill(
        path.join(tempRoot, '.claude', 'skills'),
        'opencode-claude-user-dir',
        'opencode-claude-user',
        'OpenCode Claude user skill',
      );
      await writeSkill(
        path.join(tempRoot, '.agents', 'skills'),
        'opencode-agents-user-dir',
        'opencode-agents-user',
        'OpenCode Agents user skill',
      );

      const skills = await providerSkillsService.listProviderSkills('opencode', { workspacePath });
      const byName = new Map(skills.map((skill) => [skill.name, skill]));

      assert.equal(byName.get('opencode-cwd')?.scope, 'project');
      assert.equal(byName.get('opencode-claude-parent')?.scope, 'project');
      assert.equal(byName.get('opencode-agents-root')?.scope, 'project');
      assert.equal(byName.get('opencode-user')?.scope, 'user');
      assert.equal(byName.get('opencode-claude-user')?.scope, 'user');
      assert.equal(byName.get('opencode-agents-user')?.scope, 'user');
      assert.equal(byName.get('opencode-cwd')?.command, '/opencode-cwd');
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers Cursor skill directory rules, including shared
   * `.agents/skills` project support.
   */
  test('providerSkillsService lists cursor skills from its configured directories', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-gc-'));
    const workspacePath = path.join(tempRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    const restoreHomeDir = patchHomeDir(tempRoot);
    try {
      await writeSkill(
        path.join(tempRoot, '.agents', 'skills'),
        'agents-user-dir',
        'agents-user',
        'Agents user skill',
      );
      await writeSkill(
        path.join(workspacePath, '.agents', 'skills'),
        'agents-project-dir',
        'agents-project',
        'Agents project skill',
      );
      await writeSkill(
        path.join(workspacePath, '.cursor', 'skills'),
        'cursor-project-dir',
        'cursor-project',
        'Cursor project skill',
      );
      await writeSkill(
        path.join(tempRoot, '.cursor', 'skills'),
        'cursor-user-dir',
        'cursor-user',
        'Cursor user skill',
      );

      const cursorSkills = await providerSkillsService.listProviderSkills('cursor', { workspacePath });
      const cursorByName = new Map(cursorSkills.map((skill) => [skill.name, skill]));
      assert.equal(cursorByName.get('agents-project')?.scope, 'project');
      assert.equal(cursorByName.get('cursor-project')?.scope, 'project');
      assert.equal(cursorByName.get('cursor-user')?.scope, 'user');
      assert.equal(cursorByName.get('cursor-user')?.command, '/cursor-user');
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers managed global skill creation for providers that own a
   * writable user skill directory.
   */
  test('providerSkillsService adds global skills for claude, codex, and cursor', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-create-'));
    const restoreHomeDir = patchHomeDir(tempRoot);

    try {
      const createdClaudeSkills = await providerSkillsService.addProviderSkills('claude', {
        entries: [
          {
            directoryName: 'claude-global-dir',
            content: '---\nname: claude-global\ndescription: Claude global skill\n---\n\nClaude body.\n',
          },
        ],
      });
      const createdClaudeSkill = createdClaudeSkills[0];
      assert.ok(createdClaudeSkill);
      assert.equal(createdClaudeSkill.command, '/claude-global');
      assert.equal(
        createdClaudeSkill.sourcePath.endsWith(path.join('.claude', 'skills', 'claude-global-dir', 'SKILL.md')),
        true,
      );
      assert.match(
        await fs.readFile(createdClaudeSkill.sourcePath, 'utf8'),
        /Claude body\./,
      );

      const createdCodexSkills = await providerSkillsService.addProviderSkills('codex', {
        entries: [
          {
            directoryName: 'uploaded-codex-folder',
            fileName: 'SKILL.md',
            content: '---\nname: codex-global\ndescription: Codex global skill\n---\n\nCodex body.\n',
            files: [
              {
                relativePath: 'scripts/run.js',
                content: Buffer.from('console.log("codex skill");\n').toString('base64'),
                encoding: 'base64',
              },
            ],
          },
        ],
      });
      const createdCodexSkill = createdCodexSkills[0];
      assert.ok(createdCodexSkill);
      assert.equal(createdCodexSkill.command, '$codex-global');
      assert.equal(
        createdCodexSkill.sourcePath.endsWith(path.join('.agents', 'skills', 'uploaded-codex-folder', 'SKILL.md')),
        true,
      );
      assert.equal(
        await fs.readFile(path.join(path.dirname(createdCodexSkill.sourcePath), 'scripts', 'run.js'), 'utf8'),
        'console.log("codex skill");\n',
      );

      const fallbackNamedSkills = await providerSkillsService.addProviderSkills('codex', {
        entries: [
          {
            fileName: 'fallback / skill.md',
            content: '---\ndescription: Normalized fallback skill\n---\n\nFallback body.\n',
          },
        ],
      });
      const fallbackNamedSkill = fallbackNamedSkills[0];
      assert.ok(fallbackNamedSkill);
      assert.equal(fallbackNamedSkill.name, 'fallback-skill');
      assert.equal(fallbackNamedSkill.command, '$fallback-skill');
      assert.equal(
        fallbackNamedSkill.sourcePath.endsWith(path.join('.agents', 'skills', 'fallback-skill', 'SKILL.md')),
        true,
      );

      const replacedCodexSkills = await providerSkillsService.addProviderSkills('codex', {
        entries: [
          {
            directoryName: 'uploaded-codex-folder',
            content: '---\nname: replacement\ndescription: Replacement skill\n---\n\nReplacement body.\n',
          },
        ],
      });
      assert.equal(replacedCodexSkills[0]?.command, '$replacement');
      assert.match(await fs.readFile(createdCodexSkill.sourcePath, 'utf8'), /Replacement body\./);
      await assert.rejects(
        fs.stat(path.join(path.dirname(createdCodexSkill.sourcePath), 'scripts', 'run.js')),
        { code: 'ENOENT' },
      );

      const pendingBatchSkillPath = path.join(tempRoot, '.agents', 'skills', 'pending-batch', 'SKILL.md');
      await assert.rejects(
        providerSkillsService.addProviderSkills('codex', {
          entries: [
            {
              directoryName: 'pending-batch',
              content: '---\nname: pending-batch\n---\n\nPending body.\n',
            },
            {
              directoryName: 'pending-batch',
              content: '---\nname: duplicate-batch\n---\n\nDuplicate body.\n',
            },
          ],
        }),
        /duplicate skill target/i,
      );
      await assert.rejects(fs.stat(pendingBatchSkillPath), { code: 'ENOENT' });

      const createdCursorSkills = await providerSkillsService.addProviderSkills('cursor', {
        entries: [
          {
            directoryName: 'cursor-global-dir',
            content: '---\nname: cursor-global\ndescription: Cursor global skill\n---\n\nCursor body.\n',
          },
        ],
      });
      const createdCursorSkill = createdCursorSkills[0];
      assert.ok(createdCursorSkill);
      assert.equal(createdCursorSkill.command, '/cursor-global');
      assert.equal(
        createdCursorSkill.sourcePath.endsWith(path.join('.cursor', 'skills', 'cursor-global-dir', 'SKILL.md')),
        true,
      );

      const listedClaudeSkills = await providerSkillsService.listProviderSkills('claude');
      assert.equal(listedClaudeSkills.some((skill) => skill.name === 'claude-global'), true);

      const listedCodexSkills = await providerSkillsService.listProviderSkills('codex');
      assert.equal(listedCodexSkills.some((skill) => skill.name === 'replacement'), true);

      const listedCursorSkills = await providerSkillsService.listProviderSkills('cursor');
      assert.equal(listedCursorSkills.some((skill) => skill.name === 'cursor-global'), true);

      const removedCodexSkill = await providerSkillsService.removeProviderSkill('codex', {
        directoryName: 'uploaded-codex-folder',
      });
      assert.equal(removedCodexSkill.removed, true);
      assert.equal(removedCodexSkill.provider, 'codex');
      assert.equal(removedCodexSkill.directoryName, 'uploaded-codex-folder');
      await assert.rejects(fs.stat(path.dirname(createdCodexSkill.sourcePath)), { code: 'ENOENT' });

      const removedMissingSkill = await providerSkillsService.removeProviderSkill('codex', {
        directoryName: 'uploaded-codex-folder',
      });
      assert.equal(removedMissingSkill.removed, false);

      await assert.rejects(
        providerSkillsService.addProviderSkills('codex', {
          entries: [
            {
              content: '---\nname: unsafe-skill\n---\n',
              files: [
                {
                  relativePath: '../outside.js',
                  content: '',
                  encoding: 'utf8',
                },
              ],
            },
          ],
        }),
        /invalid supporting file path/i,
      );
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * OpenCode reuses other providers' skill folders, so it should not accept
   * direct skill writes through the managed provider endpoint.
   */
  test('providerSkillsService rejects managed skill creation for opencode', { concurrency: false }, async () => {
    await assert.rejects(
      providerSkillsService.addProviderSkills('opencode', {
        entries: [
          {
            directoryName: 'opencode-global-dir',
            content: '---\nname: opencode-global\ndescription: Unsupported skill\n---\n\nOpenCode body.\n',
          },
        ],
      }),
      /does not support managed global skills/i,
    );

    await assert.rejects(
      providerSkillsService.removeProviderSkill('opencode', {
        directoryName: 'opencode-global-dir',
      }),
      /does not support managed global skills/i,
    );
  });
});

describe('provider service status', () => {
  const statusResponse = (components: Array<{ name: string; status: string }>, status = 200) => (
    new Response(JSON.stringify({ components }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );

  test('uses the worst Claude Code/API state and ignores unrelated components', async () => {
    const requestedUrls: string[] = [];
    const service = createProviderServiceStatusService({
      now: () => Date.parse('2026-09-03T14:00:00.000Z'),
      fetch: (async (input) => {
        requestedUrls.push(String(input));
        return statusResponse([
          { name: 'claude.ai', status: 'major_outage' },
          { name: 'Claude API (api.anthropic.com)', status: 'degraded_performance' },
          { name: 'Claude Code', status: 'partial_outage' },
        ]);
      }) as typeof fetch,
    });

    const status = await service.getProviderServiceStatus('claude');

    assert.deepEqual(requestedUrls, ['https://status.claude.com/api/v2/summary.json']);
    assert.deepEqual(status, {
      provider: 'claude',
      state: 'partial_outage',
      statusPageUrl: 'https://status.claude.com/',
      checkedAt: '2026-09-03T14:00:00.000Z',
    });
  });

  test('uses Codex API status rather than Codex Web or the page-wide state', async () => {
    const service = createProviderServiceStatusService({
      fetch: (async () => statusResponse([
        { name: 'Codex Web', status: 'major_outage' },
        { name: 'Codex API', status: 'degraded_performance' },
      ])) as typeof fetch,
    });

    assert.equal((await service.getProviderServiceStatus('codex')).state, 'degraded');
  });

  test('reports unavailable when a required component or valid response is absent', async () => {
    const missingComponent = createProviderServiceStatusService({
      fetch: (async () => statusResponse([
        { name: 'Claude Code', status: 'operational' },
      ])) as typeof fetch,
    });
    const failedRequest = createProviderServiceStatusService({
      fetch: (async () => statusResponse([], 503)) as typeof fetch,
    });

    assert.equal((await missingComponent.getProviderServiceStatus('claude')).state, 'unavailable');
    assert.equal((await failedRequest.getProviderServiceStatus('codex')).state, 'unavailable');
  });

  test('caches a successful reading for the configured TTL', async () => {
    let now = 1_000;
    let fetchCount = 0;
    const service = createProviderServiceStatusService({
      now: () => now,
      cacheTtlMs: 60_000,
      fetch: (async () => {
        fetchCount += 1;
        return statusResponse([{ name: 'Codex API', status: 'operational' }]);
      }) as typeof fetch,
    });

    await service.getProviderServiceStatus('codex');
    now += 59_999;
    await service.getProviderServiceStatus('codex');
    assert.equal(fetchCount, 1);

    now += 2;
    await service.getProviderServiceStatus('codex');
    assert.equal(fetchCount, 2);
  });

  test('rejects providers without a configured public status component', async () => {
    const service = createProviderServiceStatusService();

    await assert.rejects(
      service.getProviderServiceStatus('cursor'),
      (error: unknown) => error instanceof AppError
        && error.code === 'PROVIDER_SERVICE_STATUS_UNSUPPORTED',
    );
  });

  test('advertises status-page links only for providers with a live status source', () => {
    assert.equal(
      providerCapabilitiesService.getProviderCapabilities('claude').serviceStatusPageUrl,
      'https://status.claude.com/',
    );
    assert.equal(
      providerCapabilitiesService.getProviderCapabilities('codex').serviceStatusPageUrl,
      'https://status.openai.com/',
    );
    assert.equal(providerCapabilitiesService.getProviderCapabilities('cursor').serviceStatusPageUrl, null);
    assert.equal(providerCapabilitiesService.getProviderCapabilities('opencode').serviceStatusPageUrl, null);
  });
});
