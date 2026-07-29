type McpTextContent = {
  type: 'text';
  text: string;
};

type McpImageContent = {
  type: 'image';
  data: string;
  mimeType: 'image/jpeg';
};

type BrowserScreenshotApiResult = {
  session: {
    id: string;
    url: string | null;
    title: string | null;
    updatedAt: string;
  };
  data: string;
  mimeType: 'image/jpeg';
};

export const ORDINARY_BROWSER_RESULT_MAX_BYTES = 4_096;

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('Browser API returned an unserializable result.');
  }
  return serialized;
}

function textResponse(text: string): { content: [McpTextContent] } {
  return {
    content: [{ type: 'text', text }],
  };
}

function assertNoScreenshotDataUrlField(text: string): void {
  if (text.includes('"screenshotDataUrl":')) {
    throw new Error('Browser result included screenshot data outside the explicit screenshot tool.');
  }
}

export function browserJsonResponse(value: unknown): { content: [McpTextContent] } {
  const text = serializeJson(value);
  assertNoScreenshotDataUrlField(text);
  const resultBytes = Buffer.byteLength(text, 'utf8');
  if (resultBytes > ORDINARY_BROWSER_RESULT_MAX_BYTES) {
    throw new Error(
      `Browser result exceeded the ${ORDINARY_BROWSER_RESULT_MAX_BYTES}-byte limit (${resultBytes} bytes).`,
    );
  }
  return textResponse(text);
}

export function browserSnapshotResponse(value: unknown): { content: [McpTextContent] } {
  const text = serializeJson(value);
  assertNoScreenshotDataUrlField(text);
  return textResponse(text);
}

function readScreenshotResult(value: unknown): BrowserScreenshotApiResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Browser screenshot response is missing JPEG image data.');
  }

  const result = value as Partial<BrowserScreenshotApiResult>;
  if (
    typeof result.data !== 'string'
    || result.data.length === 0
    || result.mimeType !== 'image/jpeg'
    || !result.session
    || typeof result.session.id !== 'string'
  ) {
    throw new Error('Browser screenshot response is missing JPEG image data.');
  }

  return result as BrowserScreenshotApiResult;
}

export function browserScreenshotResponse(
  value: unknown,
): { content: [McpTextContent, McpImageContent] } {
  const result = readScreenshotResult(value);
  const metadata = {
    sessionId: result.session.id,
    url: result.session.url,
    title: result.session.title,
    updatedAt: result.session.updatedAt,
  };

  return {
    content: [
      { type: 'text', text: serializeJson(metadata) },
      { type: 'image', data: result.data, mimeType: result.mimeType },
    ],
  };
}
