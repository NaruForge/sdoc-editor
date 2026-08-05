import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KrokiDiagramService,
  KrokiRenderError,
  resolvePersistedDiagramRendererConsent,
  validateKrokiEndpoint,
} from '../src/services/KrokiDiagramService';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, 'close');
  }));
});

describe('Kroki endpoint trust boundary', () => {
  it('accepts the public HTTPS default and localhost HTTP', async () => {
    await expect(validateKrokiEndpoint('https://kroki.io')).resolves.toMatchObject({
      protocol: 'https:',
      hostname: 'kroki.io',
    });
    await expect(validateKrokiEndpoint('http://localhost:8000')).resolves.toMatchObject({
      protocol: 'http:',
      hostname: 'localhost',
    });
  });

  it('rejects credentials, query, fragment, unsafe schemes, and private addresses', async () => {
    const invalid = [
      'https://user:pass@kroki.io',
      'https://kroki.io?token=secret',
      'https://kroki.io/#fragment',
      'http://kroki.io',
      'file:///tmp/kroki',
      'https://169.254.169.254',
      'https://100.100.100.200',
      'https://168.63.129.16',
      'https://0.0.0.0',
      'https://224.0.0.1',
      'https://[fd00:ec2::254]',
      'https://[64:ff9b::a00:1]',
      'https://[2002:0a00:0001::]',
      'https://192.168.1.10',
    ];
    for (const endpoint of invalid) {
      await expect(validateKrokiEndpoint(endpoint)).rejects.toBeInstanceOf(KrokiRenderError);
    }
  });

  it('allows an HTTPS private endpoint only with explicit opt-in', async () => {
    await expect(validateKrokiEndpoint('https://192.168.1.10', true)).resolves.toMatchObject({
      hostname: '192.168.1.10',
    });
  });
});

describe('diagram renderer consent migration', () => {
  it('preserves a stored consent decision without consulting the legacy setting', () => {
    expect(resolvePersistedDiagramRendererConsent('declined', true)).toEqual({
      consent: 'declined',
      needsMigration: false,
    });
  });

  it('migrates only legacy true to granted and defaults false or absent to undecided', () => {
    expect(resolvePersistedDiagramRendererConsent(undefined, true)).toEqual({
      consent: 'granted',
      needsMigration: true,
    });
    expect(resolvePersistedDiagramRendererConsent(undefined, false)).toEqual({
      consent: 'undecided',
      needsMigration: true,
    });
    expect(resolvePersistedDiagramRendererConsent(undefined, undefined)).toEqual({
      consent: 'undecided',
      needsMigration: true,
    });
  });
});

describe('Kroki renderer', () => {
  it('posts plain text, validates PNG, and caches in memory', async () => {
    let requests = 0;
    const server = createServer((request, response) => {
      requests += 1;
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/plantuml/png');
      expect(request.headers['content-type']).toContain('text/plain');
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_1X1);
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');

    const service = new KrokiDiagramService({
      consent: 'granted',
      endpoint: `http://127.0.0.1:${address.port}`,
      allowPrivateNetwork: false,
    });
    const first = await service.render('plantuml', '@startuml\nAlice -> Bob\n@enduml');
    const second = await service.render('plantuml', '@startuml\nAlice -> Bob\n@enduml');

    expect(first.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(second).toMatchObject({
      dataUrl: first.dataUrl,
      width: first.width,
      height: first.height,
      cached: true,
    });
    expect(requests).toBe(1);
  });

  it('invalidates cached renders when the private-network trust setting changes', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG_1X1);
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');

    const endpoint = `http://127.0.0.1:${address.port}`;
    const service = new KrokiDiagramService({
      consent: 'granted',
      endpoint,
      allowPrivateNetwork: false,
    });
    await service.render('d2', 'a -> b');
    service.updateSettings({ consent: 'granted', endpoint, allowPrivateNetwork: true });
    await service.render('d2', 'a -> b');

    expect(requests).toBe(2);
  });

  it('cancels an in-flight request when granted consent is revoked', async () => {
    const server = createServer(() => {
      // Leave the response pending so revocation owns cancellation.
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');

    const endpoint = `http://127.0.0.1:${address.port}`;
    const service = new KrokiDiagramService({
      consent: 'granted',
      endpoint,
      allowPrivateNetwork: false,
    });
    const pending = service.render('graphviz', 'digraph { a -> b }');
    await once(server, 'request');

    service.updateSettings({ consent: 'declined', endpoint, allowPrivateNetwork: false });

    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('rejects redirects, oversized input, wrong MIME, invalid PNG, and excessive pixels', async () => {
    const handlers = [
      (_request: unknown, response: import('node:http').ServerResponse) => {
        response.writeHead(302, { location: 'https://example.com' });
        response.end();
      },
      (_request: unknown, response: import('node:http').ServerResponse) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('not png');
      },
      (_request: unknown, response: import('node:http').ServerResponse) => {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(Buffer.from('not png'));
      },
      (_request: unknown, response: import('node:http').ServerResponse) => {
        const huge = Buffer.from(PNG_1X1);
        huge.writeUInt32BE(8192, 16);
        huge.writeUInt32BE(8192, 20);
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(huge);
      },
    ];

    for (const handler of handlers) {
      const server = createServer(handler);
      servers.push(server);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server address');
      const service = new KrokiDiagramService({
        consent: 'granted',
        endpoint: `http://127.0.0.1:${address.port}`,
        allowPrivateNetwork: false,
      });
      await expect(service.render('d2', 'a -> b')).rejects.toBeInstanceOf(KrokiRenderError);
    }

    for (const consent of ['undecided', 'declined'] as const) {
      const disabled = new KrokiDiagramService({
        consent,
        endpoint: 'https://kroki.io',
        allowPrivateNetwork: false,
      });
      await expect(disabled.render('graphviz', 'x'.repeat(100 * 1024 + 1))).rejects.toMatchObject({
        code: 'disabled',
      });
    }
    const enabled = new KrokiDiagramService({
      consent: 'granted',
      endpoint: 'https://kroki.io',
      allowPrivateNetwork: false,
    });
    await expect(enabled.render('graphviz', 'x'.repeat(100 * 1024 + 1))).rejects.toMatchObject({
      code: 'source-too-large',
    });
  });
});
