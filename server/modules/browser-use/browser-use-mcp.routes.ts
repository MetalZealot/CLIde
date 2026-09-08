import express from 'express';

import { browserMcpEndpoint } from '@/modules/browser-use/browser-use-mcp-endpoint.service.js';
import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

const router = express.Router();

function readBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

router.use((req, res, next) => {
  const expected = browserUseService.getMcpToken();
  const token = readBearerToken(req.headers.authorization);
  if (!token || token !== expected) {
    res.status(401).json({ success: false, error: 'Invalid Browser MCP token.' });
    return;
  }
  next();
});

// Official Playwright MCP over Streamable HTTP: POST initialize or a request,
// GET the notification stream, DELETE to end the session and its context.
const handleMcpRequest = async (req: express.Request, res: express.Response) => {
  try {
    await browserMcpEndpoint.handleRequest(req, res);
  } catch (error) {
    if (res.headersSent) {
      return;
    }
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Browser MCP request failed.',
      },
      id: null,
    });
  }
};

router.post('/mcp', handleMcpRequest);
router.get('/mcp', handleMcpRequest);
router.delete('/mcp', handleMcpRequest);

export default router;
