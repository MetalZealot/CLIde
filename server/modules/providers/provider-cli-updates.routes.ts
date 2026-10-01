import express, { type Request, type Response } from 'express';

import {
  readClaudeUpdateChannel,
  writeClaudeUpdateChannel,
} from '@/modules/providers/list/claude/claude-update-channel.settings.js';
import { claudePluginUpdatesService } from '@/modules/providers/services/claude-plugin-updates.service.js';
import { claudeSdkReleaseService } from '@/modules/providers/services/claude-sdk-release.service.js';
import { providerCliUpdatesService } from '@/modules/providers/services/provider-cli-updates.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

/** Mounted behind provider authentication; clients choose providers, never commands. */
export function createProviderCliUpdatesRouter(
  service: Pick<typeof providerCliUpdatesService, 'getStatus' | 'startUpdate' | 'cancelUpdate' | 'recheck'> = providerCliUpdatesService,
  pluginService: Pick<typeof claudePluginUpdatesService, 'getStatus' | 'startUpdate'> = claudePluginUpdatesService,
  sdkReleaseService: Pick<typeof claudeSdkReleaseService, 'getStatus'> = claudeSdkReleaseService,
): express.Router {
  const router = express.Router();
  const providerFrom = (req: Request): 'claude' | 'codex' => {
    const provider = req.params.provider;
    if (provider !== 'claude' && provider !== 'codex') {
      throw new AppError('CLI updates are supported for Claude and Codex.', { statusCode: 400, code: 'UNSUPPORTED_CLI_UPDATE' });
    }
    return provider;
  };
  router.get('/:provider/cli-update', asyncHandler(async (req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await service.getStatus(providerFrom(req))));
  }));
  router.post('/:provider/cli-update', asyncHandler(async (req: Request, res: Response) => {
    res.status(202).json(createApiSuccessResponse(await service.startUpdate(providerFrom(req))));
  }));
  router.delete('/:provider/cli-update', asyncHandler(async (req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await service.cancelUpdate(providerFrom(req))));
  }));
  router.get('/claude/update-channel', asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await readClaudeUpdateChannel()));
  }));
  router.put('/claude/update-channel', asyncHandler(async (req: Request, res: Response) => {
    const channel = (req.body as { channel?: unknown } | undefined)?.channel;
    if (channel !== 'latest' && channel !== 'stable') {
      throw new AppError('channel must be "latest" or "stable".', { statusCode: 400, code: 'INVALID_REQUEST_BODY' });
    }
    // Stable records the installed build as its floor, so an unknown version must not guess one.
    const { installedVersion } = await service.getStatus('claude');
    if (!installedVersion) {
      throw new AppError('Could not read the installed Claude Code version.', { statusCode: 503, code: 'CLI_VERSION_UNAVAILABLE' });
    }
    const settings = await writeClaudeUpdateChannel(channel, installedVersion);
    service.recheck('claude');
    res.json(createApiSuccessResponse(settings));
  }));
  router.get('/claude/plugin-update', asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await pluginService.getStatus()));
  }));
  router.post('/claude/plugin-update', asyncHandler(async (req: Request, res: Response) => {
    const ifStale = (req.body as { ifStale?: unknown } | undefined)?.ifStale === true;
    res.status(202).json(createApiSuccessResponse(await pluginService.startUpdate({ ifStale })));
  }));
  router.get('/claude/sdk-release', asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await sdkReleaseService.getStatus()));
  }));
  return router;
}
