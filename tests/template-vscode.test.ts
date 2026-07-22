import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VsCodeTemplateService,
  isFilesystemBackedScheme,
  isWorkspaceTemplatePath,
  runNewSdocWorkflow,
  suggestSdocFileName,
  validateDocumentTitle,
  type NewSdocWorkflowHost,
  type WorkspaceTemplateRoot,
} from '../src/services/VsCodeTemplateService';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sdoc-template-vscode-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

const workspace = (rootPath: string, name = 'Workspace'): WorkspaceTemplateRoot => ({
  identity: `file://${rootPath}`,
  name,
  rootPath,
});

const minimalTemplate = (name: string) => ({
  sdoc: '1.0',
  meta: {
    title: name,
    template: { name, description: `${name} description`, category: 'test' },
  },
  doc: { type: 'doc', content: [] },
});

describe('VS Code template discovery', () => {
  it('discovers non-recursive workspace templates from every root in stable order', async () => {
    const first = await createTemporaryDirectory();
    const second = await createTemporaryDirectory();
    const firstTemplates = path.join(first, '.sdoc', 'templates');
    const secondTemplates = path.join(second, '.sdoc', 'templates');
    await mkdir(path.join(firstTemplates, 'nested'), { recursive: true });
    await mkdir(secondTemplates, { recursive: true });
    await writeFile(path.join(firstTemplates, 'zeta.sdoc'), JSON.stringify(minimalTemplate('Zeta')));
    await writeFile(path.join(firstTemplates, 'alpha.sdoc'), JSON.stringify(minimalTemplate('Alpha')));
    await writeFile(path.join(firstTemplates, 'ignored.txt'), '{}');
    await writeFile(path.join(firstTemplates, 'nested', 'ignored.sdoc'), JSON.stringify(minimalTemplate('Nested')));
    await writeFile(path.join(secondTemplates, 'beta.sdoc'), JSON.stringify(minimalTemplate('Beta')));

    const result = await new VsCodeTemplateService().discover([
      workspace(first, 'First'),
      workspace(second, 'Second'),
    ]);

    expect(result.catalog.templates.slice(4).map((template) => template.descriptor.name))
      .toEqual(['Alpha', 'Zeta', 'Beta']);
    expect(result.catalog.templates.slice(4).map((template) => template.descriptor.sourceLabel))
      .toEqual([
        'First · .sdoc/templates/alpha.sdoc',
        'First · .sdoc/templates/zeta.sdoc',
        'Second · .sdoc/templates/beta.sdoc',
      ]);
    expect(result.hostDiagnostics).toEqual([]);
  });

  it('keeps valid templates when another file is malformed or too large', async () => {
    const root = await createTemporaryDirectory();
    const templates = path.join(root, '.sdoc', 'templates');
    await mkdir(templates, { recursive: true });
    await writeFile(path.join(templates, 'good.sdoc'), JSON.stringify(minimalTemplate('Good')));
    await writeFile(path.join(templates, 'broken.sdoc'), '{');
    await writeFile(path.join(templates, 'large.sdoc'), 'x'.repeat(2 * 1024 * 1024 + 1));

    const result = await new VsCodeTemplateService().discover([workspace(root)]);

    expect(result.catalog.templates.some((template) => template.descriptor.name === 'Good')).toBe(true);
    expect(result.hostDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['invalid-json', 'file-too-large']),
    );
  });

  it('rejects a template directory that resolves outside the workspace', async () => {
    const root = await createTemporaryDirectory();
    const outside = await createTemporaryDirectory();
    await mkdir(path.join(root, '.sdoc'), { recursive: true });
    await writeFile(path.join(outside, 'escape.sdoc'), JSON.stringify(minimalTemplate('Escape')));
    await symlink(outside, path.join(root, '.sdoc', 'templates'), 'junction');

    const result = await new VsCodeTemplateService().discover([workspace(root)]);

    expect(result.catalog.templates.some((template) => template.descriptor.name === 'Escape')).toBe(false);
    expect(result.hostDiagnostics).toEqual([
      expect.objectContaining({ code: 'template-root-outside-workspace' }),
    ]);
  });

  it('loads at most 100 workspace templates and reports the limit', async () => {
    const root = await createTemporaryDirectory();
    const templates = path.join(root, '.sdoc', 'templates');
    await mkdir(templates, { recursive: true });
    await Promise.all(Array.from({ length: 101 }, (_, index) =>
      writeFile(
        path.join(templates, `${String(index).padStart(3, '0')}.sdoc`),
        JSON.stringify(minimalTemplate(`Template ${index}`)),
      )));

    const result = await new VsCodeTemplateService().discover([workspace(root)]);

    expect(result.catalog.templates.filter((template) => template.descriptor.source === 'workspace'))
      .toHaveLength(100);
    expect(result.hostDiagnostics).toEqual([
      expect.objectContaining({ code: 'candidate-limit-exceeded' }),
    ]);
  });
});

describe('VS Code template creation workflow', () => {
  it('selects, instantiates, exclusively creates, and opens a new document', async () => {
    const root = await createTemporaryDirectory();
    const targetPath = path.join(root, 'System Design.sdoc');
    const service = new VsCodeTemplateService();
    const host: NewSdocWorkflowHost = {
      selectTemplate: vi.fn(async (templates) => templates[0]),
      requestTitle: vi.fn(async () => 'System Design'),
      selectTarget: vi.fn(async (defaultName) => {
        expect(defaultName).toBe('System Design.sdoc');
        return targetPath;
      }),
      flushActiveDocument: vi.fn(async () => undefined),
      openDocument: vi.fn(async () => undefined),
      reportDiagnostics: vi.fn(),
    };

    const created = await runNewSdocWorkflow(service, [workspace(root)], host, {
      now: () => new Date('2026-07-22T00:00:00.000Z'),
    });

    expect(created).toBe(targetPath);
    expect(host.flushActiveDocument).toHaveBeenCalledOnce();
    expect(host.openDocument).toHaveBeenCalledWith(targetPath);
    const persisted: unknown = JSON.parse(await readFile(targetPath, 'utf8'));
    expect(persisted).toMatchObject({
      sdoc: '1.0',
      meta: {
        title: 'System Design',
        author: '',
        version: '0.1',
        created: '2026-07-22T00:00:00.000Z',
        modified: '2026-07-22T00:00:00.000Z',
      },
    });
  });

  it('does not write when any dialog is cancelled or flush fails', async () => {
    const root = await createTemporaryDirectory();
    const targetPath = path.join(root, 'cancelled.sdoc');
    const service = new VsCodeTemplateService();
    const baseHost: NewSdocWorkflowHost = {
      selectTemplate: vi.fn(async (templates) => templates[0]),
      requestTitle: vi.fn(async () => 'Cancelled'),
      selectTarget: vi.fn(async () => targetPath),
      flushActiveDocument: vi.fn(async () => undefined),
      openDocument: vi.fn(async () => undefined),
      reportDiagnostics: vi.fn(),
    };

    await expect(runNewSdocWorkflow(service, [workspace(root)], {
      ...baseHost,
      selectTemplate: vi.fn(async () => undefined),
    })).resolves.toBeUndefined();
    await expect(runNewSdocWorkflow(service, [workspace(root)], {
      ...baseHost,
      flushActiveDocument: vi.fn(async () => { throw new Error('flush failed'); }),
    })).rejects.toThrow('flush failed');
    await expect(readFile(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(baseHost.openDocument).not.toHaveBeenCalled();
  });

  it('preserves existing files and rejects destinations in a template directory', async () => {
    const root = await createTemporaryDirectory();
    const templateDirectory = path.join(root, '.sdoc', 'templates');
    const existingPath = path.join(root, 'existing.sdoc');
    await mkdir(templateDirectory, { recursive: true });
    await writeFile(existingPath, 'original');
    const service = new VsCodeTemplateService();
    const template = (await service.discover([workspace(root)])).catalog.templates[0];

    await expect(service.createExclusive(template, 'Existing', existingPath, [workspace(root)]))
      .rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(existingPath, 'utf8')).toBe('original');
    await expect(service.createExclusive(
      template,
      'Forbidden',
      path.join(templateDirectory, 'forbidden.sdoc'),
      [workspace(root)],
    )).rejects.toThrow('template directory');
  });

  it('rejects every .sdoc/templates destination even outside the active workspaces', async () => {
    const root = await createTemporaryDirectory();
    const templateDirectory = path.join(root, '.sdoc', 'templates');
    await mkdir(templateDirectory, { recursive: true });
    const targetPath = path.join(templateDirectory, 'forbidden.sdoc');
    const service = new VsCodeTemplateService();
    const template = (await service.discover([])).catalog.templates[0];

    await expect(service.createExclusive(template, 'Forbidden', targetPath, []))
      .rejects.toThrow('template directory');
    await expect(readFile(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('validates titles and creates portable default filenames', () => {
    expect(validateDocumentTitle('')).toBeTruthy();
    expect(validateDocumentTitle('x'.repeat(201))).toBeTruthy();
    expect(validateDocumentTitle('Valid title')).toBeUndefined();
    expect(suggestSdocFileName('CON: system/design?')).toBe('CON- system-design-.sdoc');
    expect(isFilesystemBackedScheme('file')).toBe(true);
    expect(isFilesystemBackedScheme('vscode-remote')).toBe(true);
    expect(isFilesystemBackedScheme('memfs')).toBe(false);
    expect(isWorkspaceTemplatePath('C:\\repo\\.sdoc\\templates\\report.sdoc')).toBe(true);
    expect(isWorkspaceTemplatePath('/repo/docs/report.sdoc')).toBe(false);
  });
});
