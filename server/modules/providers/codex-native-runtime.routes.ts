import express, { type Request, type Response } from 'express';

import { codexNativeRuntimeManagementService } from '@/modules/providers/list/codex/codex-native-runtime-management.provider.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

type RuntimeRouteService = Pick<
  typeof codexNativeRuntimeManagementService,
  'checkInstallation' | 'getStatus' | 'selectInstallation'
>;

const INSTALLATION_ID_PATTERN = /^runtime_[a-f0-9]{24}$/;

const parseInstallationId = (body: unknown): string => {
  const installationId = body && typeof body === 'object'
    ? (body as Record<string, unknown>).installationId
    : null;
  if (typeof installationId !== 'string' || !INSTALLATION_ID_PATTERN.test(installationId)) {
    throw new AppError('A valid installationId is required.', {
      code: 'INVALID_CODEX_RUNTIME_INSTALLATION_ID',
      statusCode: 400,
    });
  }
  return installationId;
};

export const createCodexNativeRuntimeRouter = (
  service: RuntimeRouteService = codexNativeRuntimeManagementService,
): express.Router => {
  const router = express.Router();

  router.get('/', asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse(await service.getStatus()));
  }));

  router.post('/check', asyncHandler(async (req: Request, res: Response) => {
    const result = await service.checkInstallation(parseInstallationId(req.body));
    res.json(createApiSuccessResponse(result));
  }));

  router.put('/selection', asyncHandler(async (req: Request, res: Response) => {
    const result = await service.selectInstallation(parseInstallationId(req.body));
    res.json(createApiSuccessResponse(result));
  }));

  return router;
};

export default createCodexNativeRuntimeRouter();
