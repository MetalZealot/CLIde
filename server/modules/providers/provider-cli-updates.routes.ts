import express, { type Request, type Response } from 'express';

import { providerCliUpdatesService } from '@/modules/providers/services/provider-cli-updates.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

/** Mounted behind provider authentication; clients choose providers, never commands. */
export function createProviderCliUpdatesRouter(
  service: Pick<typeof providerCliUpdatesService, 'getStatus' | 'startUpdate' | 'cancelUpdate'> = providerCliUpdatesService,
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
  return router;
}
