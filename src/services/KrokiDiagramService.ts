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
    const path = `${basePath}/${language}/png`.replace(/^\/?/, '/');
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
        accept: 'image/png',
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
          const contentType = String(response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
          if (contentType !== 'image/png') {
            response.resume();
            reject(new KrokiRenderError('invalid-response', 'The renderer response is not image/png.', false));
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
              const dimensions = validatePng(bytes);
              resolve({
                dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
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
