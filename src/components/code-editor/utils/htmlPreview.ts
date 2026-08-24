export type HtmlPreviewAssetLoader = (filePath: string, signal: AbortSignal) => Promise<Blob>;

export type HtmlPreviewReference =
  | { kind: 'fragment'; fragment: string }
  | { kind: 'project'; filePath: string; suffix: string }
  | { kind: 'external'; url: string }
  | { kind: 'data'; url: string }
  | { kind: 'blocked' };

export type PrepareHtmlPreviewInput = {
  content: string;
  filePath: string;
  projectPath: string;
  loadAsset: HtmlPreviewAssetLoader;
  signal: AbortSignal;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
};

export type PreparedHtmlPreview = {
  html: string;
  warnings: string[];
  objectUrls: string[];
};

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline' blob: https:",
  'img-src blob: data: https:',
  'font-src blob: data: https:',
  'media-src blob: data: https:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const URL_ATTRIBUTE_SELECTORS: ReadonlyArray<readonly [string, string]> = [
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
  ['audio[src]', 'src'],
  ['track[src]', 'src'],
  ['input[type="image"][src]', 'src'],
  ['image[href]', 'href'],
  ['image[xlink\\:href]', 'xlink:href'],
  ['use[href]', 'href'],
  ['use[xlink\\:href]', 'xlink:href'],
];

const normalizeSlashes = (value: string): string => value.replace(/\\/g, '/');

const normalizePath = (value: string): string => {
  const normalized = normalizeSlashes(value);
  const drive = normalized.match(/^[A-Za-z]:/)?.[0] ?? '';
  const isAbsolute = Boolean(drive) || normalized.startsWith('/');
  const pathWithoutRoot = drive
    ? normalized.slice(drive.length).replace(/^\/+/, '')
    : normalized.replace(/^\/+/, '');
  const segments: string[] = [];

  for (const segment of pathWithoutRoot.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }

  const prefix = drive ? `${drive}/` : isAbsolute ? '/' : '';
  return `${prefix}${segments.join('/')}` || (isAbsolute ? prefix : '.');
};

const dirname = (filePath: string): string => {
  const normalized = normalizePath(filePath);
  const separatorIndex = normalized.lastIndexOf('/');
  if (separatorIndex < 0) return '.';
  if (separatorIndex === 0) return '/';
  return normalized.slice(0, separatorIndex);
};

const joinPath = (basePath: string, relativePath: string): string => (
  normalizePath(`${basePath.replace(/\/$/, '')}/${relativePath}`)
);

const pathIsInside = (rootPath: string, candidatePath: string): boolean => {
  const root = normalizePath(rootPath).replace(/\/$/, '');
  const candidate = normalizePath(candidatePath);
  return candidate === root || candidate.startsWith(`${root}/`);
};

const splitReference = (value: string): { path: string; suffix: string } => {
  const suffixIndex = value.search(/[?#]/);
  if (suffixIndex < 0) return { path: value, suffix: '' };
  return { path: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) };
};

const decodePath = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Resolves a document reference without ever treating the CLIde origin as the project root. */
export function resolveHtmlPreviewReference(
  reference: string,
  filePath: string,
  projectPath: string,
): HtmlPreviewReference {
  const trimmed = reference.trim();
  if (!trimmed) return { kind: 'blocked' };
  if (trimmed.startsWith('#')) return { kind: 'fragment', fragment: trimmed.slice(1) };
  if (/^data:/i.test(trimmed)) return { kind: 'data', url: trimmed };
  if (/^https:\/\//i.test(trimmed)) return { kind: 'external', url: trimmed };
  if (trimmed.startsWith('//')) return { kind: 'external', url: `https:${trimmed}` };
  if (/^[A-Za-z][A-Za-z\d+.-]*:/i.test(trimmed)) return { kind: 'blocked' };

  const { path: referencedPath, suffix } = splitReference(trimmed);
  const decodedPath = decodePath(referencedPath);
  const candidate = decodedPath.startsWith('/')
    ? joinPath(projectPath, decodedPath.replace(/^\/+/, ''))
    : joinPath(dirname(filePath), decodedPath || filePath.split('/').pop() || '');

  if (!pathIsInside(projectPath, candidate)) return { kind: 'blocked' };
  return { kind: 'project', filePath: candidate, suffix };
}

const replaceAsync = async (
  value: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => Promise<string>,
): Promise<string> => {
  const matches = [...value.matchAll(pattern)];
  if (matches.length === 0) return value;

  const replacements = await Promise.all(matches.map(replace));
  let result = '';
  let cursor = 0;
  matches.forEach((match, index) => {
    const matchIndex = match.index ?? cursor;
    result += value.slice(cursor, matchIndex) + replacements[index];
    cursor = matchIndex + match[0].length;
  });
  return result + value.slice(cursor);
};

const escapeCssString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Builds sandbox-ready HTML and rewrites project assets to authenticated blob URLs. */
export async function prepareHtmlPreview({
  content,
  filePath,
  projectPath,
  loadAsset,
  signal,
  createObjectUrl = URL.createObjectURL.bind(URL),
  revokeObjectUrl = URL.revokeObjectURL.bind(URL),
}: PrepareHtmlPreviewInput): Promise<PreparedHtmlPreview> {
  const parser = new window.DOMParser();
  const document = parser.parseFromString(content, 'text/html');
  const objectUrls: string[] = [];
  const warnings = new Set<string>();
  const assetCache = new Map<string, Promise<string | null>>();

  const warn = (reference: string) => warnings.add(reference);
  const throwIfAborted = () => {
    if (signal.aborted) throw new DOMException('Preview preparation aborted', 'AbortError');
  };

  const resolveAsset = async (
    reference: string,
    ownerPath: string,
    kind: 'asset' | 'stylesheet',
    cssAncestors: ReadonlySet<string> = new Set(),
  ): Promise<string | null> => {
    // A previous rewrite pass may have already replaced this reference.
    if (/^blob:/i.test(reference)) return reference;
    const resolved = resolveHtmlPreviewReference(reference, ownerPath, projectPath);
    if (resolved.kind === 'fragment') return `#${resolved.fragment}`;
    if (resolved.kind === 'data' || resolved.kind === 'external') return resolved.url;
    if (resolved.kind === 'blocked') {
      warn(reference);
      return null;
    }

    const cacheKey = `${kind}:${resolved.filePath}`;
    if (kind === 'stylesheet' && cssAncestors.has(resolved.filePath)) {
      warn(reference);
      return null;
    }

    let pendingUrl = assetCache.get(cacheKey);
    if (!pendingUrl) {
      pendingUrl = (async () => {
        try {
          throwIfAborted();
          const sourceBlob = await loadAsset(resolved.filePath, signal);
          throwIfAborted();
          let outputBlob = sourceBlob;

          if (kind === 'stylesheet') {
            const nextAncestors = new Set(cssAncestors).add(resolved.filePath);
            const css = await sourceBlob.text();
            const rewrittenCss = await rewriteCss(css, resolved.filePath, nextAncestors);
            outputBlob = new Blob([rewrittenCss], { type: 'text/css' });
          }

          const objectUrl = createObjectUrl(outputBlob);
          objectUrls.push(objectUrl);
          return objectUrl;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error;
          warn(reference);
          return null;
        }
      })();
      assetCache.set(cacheKey, pendingUrl);
    }

    const baseUrl = await pendingUrl;
    const fragmentIndex = resolved.suffix.indexOf('#');
    const fragment = fragmentIndex >= 0 ? resolved.suffix.slice(fragmentIndex) : '';
    return baseUrl ? `${baseUrl}${fragment}` : null;
  };

  const rewriteCss = async (
    css: string,
    ownerPath: string,
    cssAncestors: ReadonlySet<string>,
  ): Promise<string> => {
    const importsRewritten = await replaceAsync(
      css,
      /@import\s+(?:url\(\s*)?(?:(["'])(.*?)\1|([^\s);]+))\s*\)?([^;]*);/gi,
      async (match) => {
        const reference = match[2] ?? match[3] ?? '';
        const url = await resolveAsset(reference, ownerPath, 'stylesheet', cssAncestors);
        return url ? `@import url("${escapeCssString(url)}")${match[4] ?? ''};` : '';
      },
    );

    return replaceAsync(
      importsRewritten,
      /url\(\s*(?:(["'])(.*?)\1|([^\s)]+))\s*\)/gi,
      async (match) => {
        const reference = match[2] ?? match[3] ?? '';
        const url = await resolveAsset(reference, ownerPath, 'asset', cssAncestors);
        return url ? `url("${escapeCssString(url)}")` : 'url("")';
      },
    );
  };

  try {
    throwIfAborted();

    document.querySelectorAll('script, iframe, frame, object, embed, portal').forEach((element) => element.remove());
    document.querySelectorAll('base, meta[http-equiv]').forEach((element) => element.remove());
    document.querySelectorAll('*').forEach((element) => {
      for (const attribute of [...element.attributes]) {
        if (
          /^on/i.test(attribute.name)
          || attribute.name.toLowerCase() === 'srcdoc'
          || attribute.name.toLowerCase() === 'formaction'
        ) {
          element.removeAttribute(attribute.name);
        }
      }
    });
    document.querySelectorAll('form[action]').forEach((form) => form.removeAttribute('action'));

    const contentSecurityPolicy = document.createElement('meta');
    contentSecurityPolicy.httpEquiv = 'Content-Security-Policy';
    contentSecurityPolicy.content = PREVIEW_CSP;
    const referrerPolicy = document.createElement('meta');
    referrerPolicy.name = 'referrer';
    referrerPolicy.content = 'no-referrer';
    document.head.prepend(referrerPolicy);
    document.head.prepend(contentSecurityPolicy);

    const stylesheetTasks = [...document.querySelectorAll<HTMLLinkElement>('link[href]')].map(async (link) => {
      const relation = link.rel.toLowerCase().split(/\s+/);
      if (!relation.includes('stylesheet')) {
        link.remove();
        return;
      }
      const reference = link.getAttribute('href') ?? '';
      const url = await resolveAsset(reference, filePath, 'stylesheet');
      if (url) link.href = url;
      else link.remove();
    });

    const styleElementTasks = [...document.querySelectorAll<HTMLStyleElement>('style')].map(async (style) => {
      style.textContent = await rewriteCss(style.textContent ?? '', filePath, new Set());
    });

    const inlineStyleTasks = [...document.querySelectorAll<HTMLElement>('[style]')].map(async (element) => {
      const style = element.getAttribute('style') ?? '';
      element.setAttribute('style', await rewriteCss(style, filePath, new Set()));
    });

    const attributeTasks = URL_ATTRIBUTE_SELECTORS.flatMap(([selector, attribute]) => (
      [...document.querySelectorAll<Element>(selector)].map(async (element) => {
        const reference = element.getAttribute(attribute) ?? '';
        const url = await resolveAsset(reference, filePath, 'asset');
        if (url) element.setAttribute(attribute, url);
        else element.removeAttribute(attribute);
      })
    ));

    const srcsetTasks = [...document.querySelectorAll<HTMLElement>('[srcset]')].map(async (element) => {
      const candidates = (element.getAttribute('srcset') ?? '').split(',');
      const rewritten = await Promise.all(candidates.map(async (candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return null;
        const separator = trimmed.search(/\s/);
        const reference = separator < 0 ? trimmed : trimmed.slice(0, separator);
        const descriptor = separator < 0 ? '' : trimmed.slice(separator);
        const url = await resolveAsset(reference, filePath, 'asset');
        return url ? `${url}${descriptor}` : null;
      }));
      const available = rewritten.filter((candidate): candidate is string => Boolean(candidate));
      if (available.length > 0) element.setAttribute('srcset', available.join(', '));
      else element.removeAttribute('srcset');
    });

    document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
      anchor.dataset.clidePreviewHref = anchor.getAttribute('href') ?? '';
      anchor.setAttribute('href', '#');
      anchor.removeAttribute('target');
      anchor.removeAttribute('download');
    });

    await Promise.all([
      ...stylesheetTasks,
      ...styleElementTasks,
      ...inlineStyleTasks,
      ...attributeTasks,
      ...srcsetTasks,
    ]);
    throwIfAborted();

    return {
      html: `<!doctype html>\n${document.documentElement.outerHTML}`,
      warnings: [...warnings],
      objectUrls,
    };
  } catch (error) {
    objectUrls.forEach(revokeObjectUrl);
    throw error;
  }
}
