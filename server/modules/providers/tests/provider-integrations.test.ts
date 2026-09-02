import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import TOML from '@iarna/toml';

import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
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

  const writeMalformedSkill = async (
    skillsRoot: string,
    directoryName: string,
  ): Promise<void> => {
    const skillDir = path.join(skillsRoot, directoryName);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: [unterminated\n---\n',
      'utf8',
    );
  };

  const normalizeClaudeTestName = (value: string): string => (
    value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
  );

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
   * This test covers Claude source precedence plus active plugin command/skill
   * discovery and namespaced collision behavior.
   */
  test('providerSkillsService lists claude user, synced, project, and active enabled plugin skills', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-claude-'));
    const repoRoot = path.join(tempRoot, 'workspace');
    const workspacePath = path.join(repoRoot, 'packages', 'app');
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
    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
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
        path.join(tempRoot, '.claude', 'skills'),
        'claude-collision-user-dir',
        'claude-collision',
        'Claude personal variant',
      );
      await writeSkill(
        path.join(tempRoot, '.claude', 'skills', 'synced'),
        'claude-synced-dir',
        'claude-synced',
        'Claude synced skill',
      );
      await writeSkill(
        path.join(tempRoot, '.claude', 'skills', 'synced'),
        'claude-collision-synced-dir',
        'CLAUDE-COLLISION',
        'Claude synced variant',
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
      await writeSkill(
        path.join(repoRoot, '.claude', 'skills'),
        'claude-ancestor-dir',
        'claude-ancestor',
        'Claude skill above the selected workspace',
      );
      await writeSkill(
        path.join(workspacePath, '.claude', 'skills'),
        'claude-collision-project-dir',
        'claude-collision',
        'Claude project variant',
      );
      await writeMalformedSkill(
        path.join(workspacePath, '.claude', 'skills'),
        'malformed-claude-skill',
      );
      await writeClaudePluginManifest(commandPluginInstallPath, 'Notion');
      await writeClaudePluginCommand(
        path.join(commandPluginInstallPath, 'commands'),
        'insert-row',
        'Insert a Notion database row',
      );
      await writeClaudePluginCommand(
        path.join(commandPluginInstallPath, 'commands'),
        'component-collision',
        'Legacy command loser',
      );
      await writeSkill(
        path.join(commandPluginInstallPath, 'skills'),
        'command-plugin-skill-dir',
        'command-plugin-skill',
        'Skill beside a command directory',
      );
      await writeSkill(
        path.join(commandPluginInstallPath, 'skills'),
        'component-collision-dir',
        'component-collision',
        'Plugin skill winner',
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
      // Claude does not document how personal, synced, and project skills
      // resolve a name collision, so CLIde lists all three rather than guessing
      // which one the session would run.
      const collisionSkills = skills.filter((skill) => (
        normalizeClaudeTestName(skill.name) === 'claude-collision'
      ));
      assert.equal(collisionSkills.length, 3);
      assert.deepEqual(
        new Set(collisionSkills.map((skill) => skill.scope)),
        new Set(['user', 'project']),
      );
      assert.equal(new Set(collisionSkills.map((skill) => skill.sourcePath)).size, 3);
      // Only the selected workspace is scanned; its Git-root ancestor is not.
      assert.equal(byName.has('claude-ancestor'), false);

      const pluginCommand = byName.get('insert-row');
      assert.equal(pluginCommand?.scope, 'plugin');
      assert.equal(pluginCommand?.pluginName, 'Notion');
      assert.equal(pluginCommand?.pluginId, 'notion@notion-marketplace');
      assert.equal(pluginCommand?.command, '/Notion:insert-row');
      assert.equal(pluginCommand?.description, 'Insert a Notion database row');
      assert.match(pluginCommand?.sourcePath ?? '', /commands[\\/]insert-row\.md$/);
      assert.equal(byName.get('command-plugin-skill')?.scope, 'plugin');
      const componentCollision = skills.filter((skill) => (
        skill.command === '/Notion:component-collision'
      ));
      assert.equal(componentCollision.length, 1);
      assert.equal(componentCollision[0]?.description, 'Plugin skill winner');
      assert.match(componentCollision[0]?.sourcePath ?? '', /SKILL\.md$/);

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

      assert.equal(byName.has('claude-plugin-sibling'), false);
      assert.equal(byName.has('disabled-command'), false);
      assert.equal(byName.has('disabled-plugin'), false);
      assert.equal(byName.has('invalid-empty-command'), false);
      assert.equal(byName.has('invalid-at-command'), false);
      assert.equal(skills.some((skill) => skill.command.startsWith('/:')), false);

      const globalSkills = await providerSkillsService.listProviderSkills('claude');
      assert.equal(globalSkills.some((skill) => skill.scope === 'project'), false);
      assert.equal(globalSkills.some((skill) => skill.name === 'claude-user'), true);
      assert.equal(globalSkills.some((skill) => skill.name === 'insert-row'), true);
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers Codex repository/user/system skill folders, including both
   * supported user roots, every cwd-to-root level, and path-distinct names.
   */
  test('providerSkillsService lists codex repository, user, and system skills', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-codex-'));
    const repoRoot = path.join(tempRoot, 'repo');
    const workspacePath = path.join(repoRoot, 'packages', 'products', 'app');
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
        path.join(repoRoot, 'packages', 'products', '.agents', 'skills'),
        'codex-parent-dir',
        'codex-parent',
        'Codex parent skill',
      );
      await writeSkill(
        path.join(repoRoot, 'packages', '.agents', 'skills'),
        'codex-intermediate-dir',
        'codex-intermediate',
        'Codex intermediate skill',
      );
      await writeSkill(
        path.join(repoRoot, '.agents', 'skills'),
        'codex-root-dir',
        'codex-root',
        'Codex root skill',
      );
      await writeSkill(
        path.join(workspacePath, '.agents', 'skills'),
        'codex-shared-cwd-dir',
        'codex-shared',
        'Codex cwd variant',
      );
      await writeSkill(
        path.join(repoRoot, 'packages', 'products', '.agents', 'skills'),
        'codex-shared-parent-dir',
        'codex-shared',
        'Codex parent variant',
      );
      await writeSkill(
        path.join(repoRoot, '.agents', 'skills'),
        'codex-shared-root-dir',
        'codex-shared',
        'Codex root variant',
      );
      await writeMalformedSkill(
        path.join(repoRoot, 'packages', '.agents', 'skills'),
        'malformed-codex-skill',
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
      assert.equal(byName.get('codex-intermediate')?.scope, 'repo');
      assert.equal(byName.get('codex-root')?.scope, 'repo');
      assert.equal(byName.get('codex-user')?.scope, 'user');
      assert.equal(byName.get('codex-home-user')?.scope, 'user');
      assert.equal(byName.get('codex-system')?.scope, 'system');
      assert.equal(byName.get('codex-root')?.command, '$codex-root');
      const sharedSkills = skills.filter((skill) => skill.name === 'codex-shared');
      assert.equal(sharedSkills.length, 3);
      assert.equal(new Set(sharedSkills.map((skill) => skill.sourcePath)).size, 3);

      const globalSkills = await providerSkillsService.listProviderSkills('codex');
      assert.equal(globalSkills.some((skill) => skill.scope === 'repo'), false);
      assert.equal(globalSkills.some((skill) => skill.scope === 'project'), false);
      assert.equal(globalSkills.some((skill) => skill.name === 'codex-user'), true);
      assert.equal(globalSkills.some((skill) => skill.name === 'codex-system'), true);
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

      const globalSkills = await providerSkillsService.listProviderSkills('opencode');
      assert.equal(globalSkills.some((skill) => skill.scope === 'project'), false);
      assert.equal(globalSkills.some((skill) => skill.name === 'opencode-user'), true);
    } finally {
      restoreHomeDir();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  /**
   * This test covers Cursor's documented `.cursor` and shared `.agents` roots,
   * same-name variants inside one workspace, and the Claude/Codex roots CLIde
   * deliberately does not scan for Cursor.
   */
  test('providerSkillsService lists cursor skills from its configured directories', { concurrency: false }, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-skills-gc-'));
    const repoRoot = path.join(tempRoot, 'repo');
    const workspacePath = path.join(repoRoot, 'packages', 'app');
    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
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
        path.join(tempRoot, '.claude', 'skills'),
        'claude-user-dir',
        'cursor-unscanned-claude-user',
        'Claude user skill Cursor does not document reading',
      );
      await writeSkill(
        path.join(tempRoot, '.codex', 'skills'),
        'codex-user-dir',
        'cursor-unscanned-codex-user',
        'Codex user skill Cursor does not document reading',
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
      await writeSkill(
        path.join(workspacePath, '.claude', 'skills'),
        'claude-project-dir',
        'cursor-unscanned-claude-project',
        'Claude project skill Cursor does not document reading',
      );
      await writeSkill(
        path.join(workspacePath, '.codex', 'skills'),
        'codex-project-dir',
        'cursor-unscanned-codex-project',
        'Codex project skill Cursor does not document reading',
      );
      await writeSkill(
        path.join(workspacePath, '.cursor', 'skills'),
        'cursor-shared-cursor-dir',
        'cursor-shared',
        'Cursor native-root variant',
      );
      await writeSkill(
        path.join(workspacePath, '.agents', 'skills'),
        'cursor-shared-agents-dir',
        'cursor-shared',
        'Cursor shared-root variant',
      );
      await writeSkill(
        path.join(repoRoot, '.cursor', 'skills'),
        'cursor-ancestor-dir',
        'cursor-ancestor',
        'Cursor skill above the selected workspace',
      );
      await writeMalformedSkill(
        path.join(workspacePath, '.agents', 'skills'),
        'malformed-cursor-skill',
      );

      const cursorSkills = await providerSkillsService.listProviderSkills('cursor', { workspacePath });
      const cursorByName = new Map(cursorSkills.map((skill) => [skill.name, skill]));
      assert.equal(cursorByName.get('agents-project')?.scope, 'project');
      assert.equal(cursorByName.get('cursor-project')?.scope, 'project');
      assert.equal(cursorByName.get('cursor-user')?.scope, 'user');
      assert.equal(cursorByName.get('cursor-user')?.command, '/cursor-user');
      // Cursor does not document reading Claude's or Codex's roots, and the
      // shared `.agents` root is only read at the selected workspace itself.
      assert.equal(
        cursorSkills.some((skill) => skill.name.startsWith('cursor-unscanned-')),
        false,
      );
      assert.equal(cursorByName.has('cursor-ancestor'), false);
      assert.equal(cursorByName.has('agents-user'), false);
      const sharedSkills = cursorSkills.filter((skill) => skill.name === 'cursor-shared');
      assert.equal(sharedSkills.length, 2);
      assert.equal(new Set(sharedSkills.map((skill) => skill.sourcePath)).size, 2);

      const globalSkills = await providerSkillsService.listProviderSkills('cursor');
      assert.equal(globalSkills.some((skill) => skill.scope === 'project'), false);
      assert.equal(globalSkills.some((skill) => skill.name === 'cursor-user'), true);
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
