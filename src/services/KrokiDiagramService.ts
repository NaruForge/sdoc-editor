import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import type {
  DiagramRenderFailureCode,
  DiagramRendererConsent,
  DiagramRendererSettings,
} from '../../shared/diagramRenderer';

export type KrokiDiagramLanguage = 'plantuml' | 'd2' | 'graphviz';

export type KrokiRenderErrorCode = DiagramRenderFailureCode;

export const DIAGRAM_RENDERER_CONSENT_STATE_KEY =
  'structuredDocEditor.diagramRenderer.consent.v1';

export interface PersistedDiagramRendererConsentResolution {
  consent: DiagramRendererConsent;
  needsMigration: boolean;
}

export function resolvePersistedDiagramRendererConsent(
  storedConsent: unknown,
  legacyEnabled: unknown,
): PersistedDiagramRendererConsentResolution {
  if (storedConsent === 'undecided' || storedConsent === 'granted' || storedConsent === 'declined') {
    return { consent: storedConsent, needsMigration: false };
  }
  return {
    consent: legacyEnabled === true ? 'granted' : 'undecided',
    needsMigration: true,
  };
}

export class KrokiRenderError extends Error {
  constructor(
    readonly code: KrokiRenderErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'KrokiRenderError';
  }
}

export interface KrokiRenderResult {
  dataUrl: string;
  width: number;
  height: number;
  cached: boolean;
}

const SOURCE_LIMIT = 100 * 1024;
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 64;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const ACTIVE_SVG_ELEMENTS = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'audio',
  'canvas',
  'discard',
  'embed',
  'foreignobject',
  'iframe',
  'object',
  'script',
  'set',
  'video',
]);
const INTERNAL_FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;
const FONT_DATA_URL = /^data:(?:font\/[A-Za-z0-9.+-]+|application\/(?:font-[A-Za-z0-9.+-]+|x-font-[A-Za-z0-9.+-]+|vnd\.ms-fontobject))(?:;charset=[A-Za-z0-9_-]+)?;base64,[A-Za-z0-9+/=\s]+$/i;

type AddressClass = 'public' | 'loopback' | 'private' | 'always-blocked';

function ipv4Number(address: string): number | null {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
}

function ipv4InSubnet(value: number, network: string, prefix: number): boolean {
  const networkValue = ipv4Number(network);
  if (networkValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (networkValue & mask);
}

function classifyIpv4(address: string): AddressClass {
  const value = ipv4Number(address);
  if (value === null) return 'always-blocked';
  if (ipv4InSubnet(value, '127.0.0.0', 8)) return 'loopback';
  if (
    ipv4InSubnet(value, '10.0.0.0', 8)
    || ipv4InSubnet(value, '172.16.0.0', 12)
    || ipv4InSubnet(value, '192.168.0.0', 16)
    || ipv4InSubnet(value, '100.64.0.0', 10)
  ) {
    return 'private';
  }
  if (
    address === '100.100.100.200'
    || address === '168.63.129.16'
    || ipv4InSubnet(value, '0.0.0.0', 8)
    || ipv4InSubnet(value, '169.254.0.0', 16)
    || ipv4InSubnet(value, '192.0.0.0', 24)
    || ipv4InSubnet(value, '192.0.2.0', 24)
    || ipv4InSubnet(value, '192.88.99.0', 24)
    || ipv4InSubnet(value, '198.18.0.0', 15)
    || ipv4InSubnet(value, '198.51.100.0', 24)
    || ipv4InSubnet(value, '203.0.113.0', 24)
    || ipv4InSubnet(value, '224.0.0.0', 4)
    || ipv4InSubnet(value, '240.0.0.0', 4)
  ) {
    return 'always-blocked';
  }
  return 'public';
}

function ipv6Number(address: string): bigint | null {
  const normalized = address.toLowerCase().split('%')[0];
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const groups = half.split(':');
    const result: number[] = [];
    for (const group of groups) {
      if (group.includes('.')) {
        const embedded = ipv4Number(group);
        if (embedded === null) return null;
        result.push((embedded >>> 16) & 0xffff, embedded & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
        result.push(Number.parseInt(group, 16));
      }
    }
    return result;
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? '');
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => 0), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function ipv6InSubnet(value: bigint, network: string, prefix: number): boolean {
  const networkValue = ipv6Number(network);
  if (networkValue === null) return false;
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (networkValue >> shift);
}

function classifyEmbeddedIpv4(value: bigint, shift: number): AddressClass {
  const embedded = Number((value >> BigInt(shift)) & 0xffffffffn) >>> 0;
  return classifyIpv4([
    embedded >>> 24,
    (embedded >>> 16) & 0xff,
    (embedded >>> 8) & 0xff,
    embedded & 0xff,
  ].join('.'));
}

function classifyIpv6(address: string): AddressClass {
  const value = ipv6Number(address);
  if (value === null) return 'always-blocked';
  if (value === 1n) return 'loopback';
  if (ipv6InSubnet(value, '::ffff:0:0', 96)) return classifyEmbeddedIpv4(value, 0);
  if (value === ipv6Number('fd00:ec2::254')) return 'always-blocked';
  if (ipv6InSubnet(value, 'fc00::', 7) || ipv6InSubnet(value, '64:ff9b:1::', 48)) {
    return 'private';
  }
  if (ipv6InSubnet(value, '64:ff9b::', 96)) return classifyEmbeddedIpv4(value, 0);
  if (ipv6InSubnet(value, '2002::', 16)) return classifyEmbeddedIpv4(value, 80);
  if (
    value === 0n
    || ipv6InSubnet(value, '::', 96)
    || ipv6InSubnet(value, 'fe80::', 10)
    || ipv6InSubnet(value, 'fec0::', 10)
    || ipv6InSubnet(value, 'ff00::', 8)
    || ipv6InSubnet(value, '2001:db8::', 32)
    || ipv6InSubnet(value, '2001::', 23)
  ) {
    return 'always-blocked';
  }
  return 'public';
}

function classifyAddress(address: string): AddressClass {
  const kind = isIP(address);
  if (kind === 4) return classifyIpv4(address);
  if (kind === 6) return classifyIpv6(address);
  return 'always-blocked';
}

function isExplicitLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || classifyAddress(normalized) === 'loopback';
}

export async function validateKrokiEndpoint(
  endpoint: string,
  allowPrivateNetwork = false,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new KrokiRenderError('invalid-endpoint', 'Enter a valid Kroki endpoint URL.', false);
  }

  if ((url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username || url.password || url.search || url.hash) {
    throw new KrokiRenderError(
      'invalid-endpoint',
      'Kroki endpoints cannot contain credentials, a query, or a fragment.',
      false,
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalKind = isIP(hostname) ? classifyAddress(hostname) : null;
  if (literalKind === 'always-blocked') {
    throw new KrokiRenderError('blocked-address', 'This network address is not allowed.', false);
  }
  if (literalKind === 'private' && !allowPrivateNetwork) {
    throw new KrokiRenderError('blocked-address', 'Private-network endpoints require explicit opt-in.', false);
  }

  const loopback = isExplicitLoopbackHost(hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw new KrokiRenderError(
      'invalid-endpoint',
      'Non-loopback Kroki endpoints must use HTTPS.',
      false,
    );
  }

  return url;
}

async function resolveEndpointAddress(
  url: URL,
  allowPrivateNetwork: boolean,
): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new KrokiRenderError('offline', 'The Kroki endpoint could not be resolved.', true);
  }

  const explicitLoopback = isExplicitLoopbackHost(hostname);
  const allowed = addresses.filter(({ address }) => {
    const addressClass = classifyAddress(address);
    if (addressClass === 'public') return true;
    if (addressClass === 'loopback') return explicitLoopback;
    if (addressClass === 'private') return allowPrivateNetwork;
    return false;
  });
  if (allowed.length !== addresses.length || allowed.length === 0) {
    throw new KrokiRenderError('blocked-address', 'The endpoint resolved to a blocked network address.', false);
  }
  return allowed[0] as { address: string; family: 4 | 6 };
}

function validatePng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new KrokiRenderError('invalid-response', 'The renderer did not return a valid PNG image.', false);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION
    || width * height > MAX_PIXELS) {
    throw new KrokiRenderError('invalid-response', 'The rendered PNG dimensions are not allowed.', false);
  }
  return { width, height };
}

function invalidSvg(message: string): KrokiRenderError {
  return new KrokiRenderError('invalid-response', message, false);
}

function decodeXmlEntities(value: string): string {
  let malformed = false;
  const unmatched = value.replace(/&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/g, '');
  if (unmatched.includes('&')) {
    throw invalidSvg('The renderer returned malformed SVG entity content.');
  }
  const decoded = value.replace(/&([^;]*);/g, (entity, body: string) => {
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    let codePoint: number | null = null;
    if (/^#[0-9]+$/.test(body)) {
      codePoint = Number.parseInt(body.slice(1), 10);
    } else if (/^#x[0-9A-Fa-f]+$/.test(body)) {
      codePoint = Number.parseInt(body.slice(2), 16);
    }
    if (codePoint === null || !(
      codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    )) {
      malformed = true;
      return entity;
    }
    return String.fromCodePoint(codePoint);
  });
  if (malformed) {
    throw invalidSvg('The renderer returned malformed SVG entity content.');
  }
  return decoded;
}

function validateCssReferences(css: string): void {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\\|expression\s*\(|(?:java|vb)script\s*:|-moz-binding|behavior\s*:/i.test(withoutComments)) {
    throw invalidSvg('The rendered SVG contains active CSS content.');
  }
  const atRules = [...withoutComments.matchAll(/@\s*([A-Za-z-]+)/g)];
  if (atRules.some((match) => match[1].toLowerCase() !== 'font-face')) {
    throw invalidSvg('The rendered SVG contains an external CSS import.');
  }
  const urlPattern = /url\s*\(\s*([^)]*?)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(withoutComments)) !== null) {
    const rawValue = match[1].trim();
    const value = (
      (rawValue.startsWith('"') && rawValue.endsWith('"'))
      || (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) ? rawValue.slice(1, -1).trim() : rawValue;
    if (!INTERNAL_FRAGMENT.test(value) && !FONT_DATA_URL.test(value)) {
      throw invalidSvg('The rendered SVG contains an external CSS reference.');
    }
  }
  if (/url\s*\(/i.test(withoutComments.replace(urlPattern, ''))) {
    throw invalidSvg('The rendered SVG contains a malformed CSS reference.');
  }
}

function parseSvgDimension(value: string): number | null {
  const match = /^\+?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?(?:px)?$/.exec(value.trim());
  if (!match) return null;
  const dimension = Number.parseFloat(value);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
}

function validateSvgDimensions(attributes: ReadonlyMap<string, string>): { width: number; height: number } {
  let sourceWidth: number | null = null;
  let sourceHeight: number | null = null;
  const widthAttribute = attributes.get('width');
  const heightAttribute = attributes.get('height');
  if (widthAttribute !== undefined || heightAttribute !== undefined) {
    if (widthAttribute === undefined || heightAttribute === undefined) {
      throw invalidSvg('The rendered SVG dimensions are incomplete.');
    }
    sourceWidth = parseSvgDimension(widthAttribute);
    sourceHeight = parseSvgDimension(heightAttribute);
  } else {
    const viewBox = attributes.get('viewbox')?.trim().split(/[\s,]+/);
    if (viewBox?.length === 4) {
      const values = viewBox.map(Number);
      if (values.every(Number.isFinite)) {
        sourceWidth = values[2] > 0 ? values[2] : null;
        sourceHeight = values[3] > 0 ? values[3] : null;
      }
    }
  }
  if (sourceWidth === null || sourceHeight === null) {
    throw invalidSvg('The rendered SVG does not have valid dimensions.');
  }
  const width = Math.ceil(sourceWidth);
  const height = Math.ceil(sourceHeight);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw invalidSvg('The rendered SVG dimensions are not allowed.');
  }
  return { width, height };
}

interface SvgElementFrame {
  name: string;
  styleParts?: string[];
}

function validateSvg(bytes: Buffer): { width: number; height: number } {
  let svg: string;
  try {
    svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidSvg('The renderer did not return valid UTF-8 SVG content.');
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svg)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(svg)) {
    throw invalidSvg('The rendered SVG contains a document type or entity declaration.');
  }

  let position = svg.charCodeAt(0) === 0xfeff ? 1 : 0;
  let rootAttributes: Map<string, string> | null = null;
  let rootClosed = false;
  const stack: SvgElementFrame[] = [];
  const skipWhitespace = () => {
    const start = position;
    while (position < svg.length && /\s/.test(svg[position])) position += 1;
    return position - start;
  };
  const readName = (): string => {
    const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(svg.slice(position));
    if (!match) throw invalidSvg('The renderer returned malformed SVG markup.');
    position += match[0].length;
    return match[0];
  };

  skipWhitespace();
  if (svg.startsWith('<?xml', position)) {
    const end = svg.indexOf('?>', position + 5);
    const declaration = end < 0 ? '' : svg.slice(position, end + 2);
    const validDeclaration = /^<\?xml\s+version\s*=\s*(?:"1\.[01]"|'1\.[01]')(?:\s+encoding\s*=\s*(?:"UTF-8"|'UTF-8'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>$/i;
    if (end < 0 || !validDeclaration.test(declaration)) {
      throw invalidSvg('The renderer returned a malformed XML declaration.');
    }
    position = end + 2;
  }

  while (position < svg.length) {
    if (svg[position] !== '<') {
      const end = svg.indexOf('<', position);
      const text = svg.slice(position, end < 0 ? svg.length : end);
      if (stack.length === 0 && text.trim() !== '') {
        throw invalidSvg('The rendered SVG contains content outside its root element.');
      }
      const decoded = decodeXmlEntities(text);
      stack.at(-1)?.styleParts?.push(decoded);
      position = end < 0 ? svg.length : end;
      continue;
    }
    if (svg.startsWith('<!--', position)) {
      const end = svg.indexOf('-->', position + 4);
      if (end < 0 || svg.slice(position + 4, end).includes('--')) {
        throw invalidSvg('The renderer returned a malformed SVG comment.');
      }
      position = end + 3;
      continue;
    }
    if (svg.startsWith('<![CDATA[', position)) {
      const end = svg.indexOf(']]>', position + 9);
      if (end < 0 || stack.length === 0) {
        throw invalidSvg('The renderer returned malformed SVG character data.');
      }
      stack.at(-1)?.styleParts?.push(svg.slice(position + 9, end));
      position = end + 3;
      continue;
    }
    if (svg.startsWith('<?', position) || svg.startsWith('<!', position)) {
      throw invalidSvg('The rendered SVG contains an unsupported declaration.');
    }
    if (svg.startsWith('</', position)) {
      position += 2;
      const name = readName();
      skipWhitespace();
      if (svg[position] !== '>') {
        throw invalidSvg('The renderer returned a malformed SVG closing tag.');
      }
      position += 1;
      const frame = stack.pop();
      if (!frame || frame.name !== name) {
        throw invalidSvg('The renderer returned mismatched SVG elements.');
      }
      if (frame.styleParts) validateCssReferences(frame.styleParts.join(''));
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    position += 1;
    const name = readName();
    const localName = name.split(':').at(-1)?.toLowerCase() ?? '';
    if (rootClosed || ACTIVE_SVG_ELEMENTS.has(localName)) {
      throw invalidSvg('The rendered SVG contains active or additional root content.');
    }
    const attributes = new Map<string, string>();
    let selfClosing = false;
    while (position < svg.length) {
      const whitespace = skipWhitespace();
      if (svg.startsWith('/>', position)) {
        selfClosing = true;
        position += 2;
        break;
      }
      if (svg[position] === '>') {
        position += 1;
        break;
      }
      if (whitespace === 0) {
        throw invalidSvg('The renderer returned malformed SVG attributes.');
      }
      const attributeName = readName();
      const normalizedName = attributeName.toLowerCase();
      if (attributes.has(normalizedName)) {
        throw invalidSvg('The renderer returned duplicate SVG attributes.');
      }
      skipWhitespace();
      if (svg[position] !== '=') {
        throw invalidSvg('The renderer returned malformed SVG attributes.');
      }
      position += 1;
      skipWhitespace();
      const quote = svg[position];
      if (quote !== '"' && quote !== "'") {
        throw invalidSvg('The renderer returned an unquoted SVG attribute.');
      }
      position += 1;
      const valueEnd = svg.indexOf(quote, position);
      if (valueEnd < 0 || svg.slice(position, valueEnd).includes('<')) {
        throw invalidSvg('The renderer returned malformed SVG attributes.');
      }
      const value = decodeXmlEntities(svg.slice(position, valueEnd));
      position = valueEnd + 1;
      attributes.set(normalizedName, value);

      const attributeLocalName = normalizedName.split(':').at(-1) ?? '';
      if (attributeLocalName.startsWith('on') || normalizedName === 'xml:base'
        || attributeLocalName === 'srcdoc') {
        throw invalidSvg('The rendered SVG contains an active attribute.');
      }
      if ((attributeLocalName === 'href' || attributeLocalName === 'src')
        && !INTERNAL_FRAGMENT.test(value.trim())) {
        throw invalidSvg('The rendered SVG contains an external reference.');
      }
      if (/url\s*\(|(?:java|vb)script\s*:/i.test(value)) validateCssReferences(value);
      if (normalizedName === 'xmlns' && value !== SVG_NAMESPACE) {
        throw invalidSvg('The rendered SVG uses an unsupported namespace.');
      }
      if (normalizedName.startsWith('xmlns:') && value !== XLINK_NAMESPACE) {
        throw invalidSvg('The rendered SVG uses an unsupported namespace.');
      }
    }

    if (rootAttributes === null) {
      if (name !== 'svg' || attributes.get('xmlns') !== SVG_NAMESPACE) {
        throw invalidSvg('The renderer response root is not an SVG image.');
      }
      rootAttributes = attributes;
    }
    const frame: SvgElementFrame = {
      name,
      styleParts: localName === 'style' ? [] : undefined,
    };
    if (selfClosing) {
      if (frame.styleParts) validateCssReferences('');
      if (stack.length === 0) rootClosed = true;
    } else {
      stack.push(frame);
    }
  }
  if (!rootAttributes || !rootClosed || stack.length !== 0) {
    throw invalidSvg('The renderer returned incomplete SVG markup.');
  }
  return validateSvgDimensions(rootAttributes);
}

interface CachedRender extends KrokiRenderResult {
  byteLength: number;
}

export class KrokiDiagramService {
  private readonly cache = new Map<string, CachedRender>();
  private cacheBytes = 0;
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly activeRequests = new Set<AbortController>();

  constructor(private settings: DiagramRendererSettings) {}

  updateSettings(settings: DiagramRendererSettings): void {
    const consentRevoked = this.settings.consent === 'granted' && settings.consent !== 'granted';
    if (
      settings.consent !== this.settings.consent
      || settings.endpoint !== this.settings.endpoint
      || settings.allowPrivateNetwork !== this.settings.allowPrivateNetwork
    ) {
      this.clearCache();
    }
    this.settings = settings;
    if (consentRevoked) {
      this.activeRequests.forEach((controller) => controller.abort());
      this.activeRequests.clear();
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
  }

  async render(
    language: KrokiDiagramLanguage,
    source: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<KrokiRenderResult> {
    if (this.settings.consent !== 'granted') {
      throw new KrokiRenderError('disabled', 'External diagram rendering has not been allowed.', false);
    }
    const requestController = new AbortController();
    const forwardCallerAbort = () => requestController.abort();
    if (options.signal?.aborted) {
      requestController.abort();
    } else {
      options.signal?.addEventListener('abort', forwardCallerAbort, { once: true });
    }
    this.activeRequests.add(requestController);
    const signal = requestController.signal;
    try {
      const sourceBytes = Buffer.from(source, 'utf8');
      if (sourceBytes.byteLength > SOURCE_LIMIT) {
        throw new KrokiRenderError('source-too-large', 'Diagram source exceeds the 100 KiB limit.', false);
      }
      const endpoint = await validateKrokiEndpoint(
        this.settings.endpoint,
        this.settings.allowPrivateNetwork,
      );
      const key = createHash('sha256')
        .update(endpoint.toString())
        .update('\0')
        .update(language)
        .update('\0')
        .update(sourceBytes)
        .digest('hex');
      const cached = this.cache.get(key);
      if (cached) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        return { dataUrl: cached.dataUrl, width: cached.width, height: cached.height, cached: true };
      }

      await this.acquire(signal);
      try {
        const result = await this.post(
          endpoint,
          language,
          sourceBytes,
          signal,
          options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
        this.remember(key, result);
        return result;
      } finally {
        this.release();
      }
    } finally {
      options.signal?.removeEventListener('abort', forwardCallerAbort);
      this.activeRequests.delete(requestController);
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new KrokiRenderError('cancelled', 'Diagram rendering was cancelled.', false);
    }
    if (this.running < 2) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        signal?.removeEventListener('abort', cancel);
        this.running += 1;
        resolve();
      };
      const cancel = () => {
        const index = this.waiting.indexOf(resume);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new KrokiRenderError('cancelled', 'Diagram rendering was cancelled.', false));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      this.waiting.push(resume);
    });
  }

  private release(): void {
    this.running -= 1;
    this.waiting.shift()?.();
  }

  private remember(key: string, result: KrokiRenderResult): void {
    const byteLength = Buffer.byteLength(result.dataUrl, 'utf8');
    const cached = { ...result, cached: false, byteLength };
    this.cache.set(key, cached);
    this.cacheBytes += byteLength;
    while (this.cache.size > MAX_CACHE_ENTRIES || this.cacheBytes > MAX_CACHE_BYTES) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      this.cacheBytes -= oldest?.byteLength ?? 0;
    }
  }

  private async post(
    endpoint: URL,
    language: KrokiDiagramLanguage,
    source: Buffer,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<KrokiRenderResult> {
    const resolved = await resolveEndpointAddress(endpoint, this.settings.allowPrivateNetwork);
    const basePath = endpoint.pathname.replace(/\/+$/, '');
    const output = language === 'd2'
      ? { format: 'svg', mimeType: 'image/svg+xml' }
      : { format: 'png', mimeType: 'image/png' };
    const path = `${basePath}/${language}/${output.format}`.replace(/^\/?/, '/');
    const requestOptions: RequestOptions = {
      protocol: endpoint.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: endpoint.port || undefined,
      method: 'POST',
      path,
      servername: endpoint.protocol === 'https:' ? endpoint.hostname : undefined,
      headers: {
        host: endpoint.host,
        accept: output.mimeType,
        'content-type': 'text/plain; charset=utf-8',
        'content-length': source.byteLength,
      },
      signal,
    };

    return new Promise<KrokiRenderResult>((resolve, reject) => {
      const request = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(
        requestOptions,
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            reject(new KrokiRenderError('redirect', 'Kroki redirects are not allowed.', false));
            return;
          }
          if (status === 429) {
            response.resume();
            reject(new KrokiRenderError('rate-limited', 'The renderer is rate limited.', true));
            return;
          }
          if (status >= 500) {
            response.resume();
            reject(new KrokiRenderError('server-error', 'The renderer is temporarily unavailable.', true));
            return;
          }
          if (status < 200 || status >= 300) {
            response.resume();
            reject(new KrokiRenderError('invalid-response', `The renderer returned HTTP ${status}.`, false));
            return;
          }
          const rawContentType = String(response.headers['content-type'] ?? '').trim().toLowerCase();
          const contentType = output.format === 'svg'
            ? rawContentType
            : rawContentType.split(';', 1)[0].trim();
          if (contentType !== output.mimeType) {
            response.resume();
            reject(new KrokiRenderError(
              'invalid-response',
              `The renderer response is not ${output.mimeType}.`,
              false,
            ));
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > RESPONSE_LIMIT) {
              response.destroy(new KrokiRenderError(
                'response-too-large',
                'The renderer response exceeds the 2 MiB limit.',
                false,
              ));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            try {
              const bytes = Buffer.concat(chunks);
              const dimensions = output.format === 'svg' ? validateSvg(bytes) : validatePng(bytes);
              resolve({
                dataUrl: `data:${output.mimeType};base64,${bytes.toString('base64')}`,
                ...dimensions,
                cached: false,
              });
            } catch (error) {
              reject(error);
            }
          });
          response.on('error', reject);
        },
      );
      request.setTimeout(timeoutMs, () => {
        request.destroy(new KrokiRenderError('timeout', 'Diagram rendering timed out.', true));
      });
      request.on('error', (error: Error) => {
        if (error instanceof KrokiRenderError) {
          reject(error);
          return;
        }
        if (signal?.aborted || error.name === 'AbortError') {
          reject(new KrokiRenderError('cancelled', 'Diagram rendering was cancelled.', false));
          return;
        }
        reject(new KrokiRenderError('offline', 'The renderer could not be reached.', true));
      });
      request.end(source);
    });
  }
}
