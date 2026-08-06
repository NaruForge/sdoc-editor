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

const SAFE_D2_SVG = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320px" height="180" viewBox="0 0 320 180">
  <style>
    @font-face { font-family: d2; src: url(data:font/woff2;base64,d09GMg==) format("woff2"); }
    .node { fill: url(#node-fill); font-family: d2; }
  </style>
  <defs><linearGradient id="node-fill"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
  <rect class="node" width="320" height="180"/>
</svg>`);

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

  it('requests and validates SVG only for D2, including embedded fonts and fragment references', async () => {
    let requests = 0;
    const server = createServer((request, response) => {
      requests += 1;
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/d2/svg');
      expect(request.headers.accept).toBe('image/svg+xml');
      expect(request.headers['content-type']).toContain('text/plain');
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end(SAFE_D2_SVG);
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
    const first = await service.render('d2', 'a -> b');
    const second = await service.render('d2', 'a -> b');

    expect(first).toMatchObject({ width: 320, height: 180, cached: false });
    expect(first.dataUrl).toBe(`data:image/svg+xml;base64,${SAFE_D2_SVG.toString('base64')}`);
    expect(second).toMatchObject({
      dataUrl: first.dataUrl,
      width: 320,
      height: 180,
      cached: true,
    });
    expect(requests).toBe(1);
  });

  it('derives D2 SVG dimensions from viewBox when root dimensions are absent', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 640.2 480.1"><path d="M0 0"/></svg>');
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end(svg);
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

    await expect(service.render('d2', 'a -> b')).resolves.toMatchObject({
      width: 641,
      height: 481,
    });
  });

  it('rejects malformed, active, externally-referencing, or excessively sized D2 SVG', async () => {
    const unsafeSvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path></svg>',
      '<html><svg width="10" height="10"/></html>',
      '<!DOCTYPE svg [<!ENTITY payload SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject><div>active</div></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><iframe srcdoc="x"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect onclick="alert(1)"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://example.com/tracker.png"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><use xlink:href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>@import url("https://example.com/a.css");</style></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>.x{fill:url(https://example.com/a.svg#x)}</style></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="8193" height="1"/>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8192 8192"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>',
    ];

    for (const [index, svg] of unsafeSvg.entries()) {
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'image/svg+xml' });
        response.end(svg);
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

      await expect(service.render('d2', `a -> b: ${index}`)).rejects.toMatchObject({
        code: 'invalid-response',
      });
    }
  });

  it('requires the exact SVG MIME type for D2 while other languages remain PNG', async () => {
    const responses = [
      {
        language: 'd2' as const,
        expectedPath: '/d2/svg',
        expectedAccept: 'image/svg+xml',
        contentType: 'image/svg+xml; charset=utf-8',
        body: SAFE_D2_SVG,
      },
      {
        language: 'd2' as const,
        expectedPath: '/d2/svg',
        expectedAccept: 'image/svg+xml',
        contentType: 'image/png',
        body: PNG_1X1,
      },
      {
        language: 'graphviz' as const,
        expectedPath: '/graphviz/png',
        expectedAccept: 'image/png',
        contentType: 'image/svg+xml',
        body: SAFE_D2_SVG,
      },
    ];

    for (const { language, expectedPath, expectedAccept, contentType, body } of responses) {
      const server = createServer((request, response) => {
        expect(request.url).toBe(expectedPath);
        expect(request.headers.accept).toBe(expectedAccept);
        response.writeHead(200, { 'content-type': contentType });
        response.end(body);
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

      await expect(service.render(language, 'a -> b')).rejects.toMatchObject({
        code: 'invalid-response',
      });
    }
  });

  it('enforces the 2 MiB response limit for D2 SVG', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!--${'x'.repeat(2 * 1024 * 1024)}--></svg>`);
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

    await expect(service.render('d2', 'a -> b')).rejects.toMatchObject({
      code: 'response-too-large',
    });
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
    await service.render('plantuml', 'a -> b');
    service.updateSettings({ consent: 'granted', endpoint, allowPrivateNetwork: true });
    await service.render('plantuml', 'a -> b');

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
      await expect(service.render('plantuml', 'a -> b')).rejects.toBeInstanceOf(KrokiRenderError);
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
