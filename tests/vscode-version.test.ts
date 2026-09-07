import { describe, expect, it } from 'vitest';
import { resolveVSCodeTestVersion, selectVSCodeTestVersions } from './vscode/versions.mjs';

describe('VS Code Host version selection', () => {
  const manifest = { engines: { vscode: '^1.85.0' } };

  it('runs both compatibility targets regardless of a local version override', () => {
    expect(selectVSCodeTestVersions(['--compatibility'], '1.90.2')).toEqual(['minimum', 'stable']);
    expect(selectVSCodeTestVersions(['--minimum'], 'stable')).toEqual(['minimum']);
    expect(selectVSCodeTestVersions([], 'minimum')).toEqual(['minimum']);
    expect(selectVSCodeTestVersions([])).toEqual(['stable']);
  });

  it('rejects misspelled or conflicting options rather than silently running the default', () => {
    expect(() => selectVSCodeTestVersions(['--minimun'])).toThrow(/option/);
    expect(() => selectVSCodeTestVersions(['--minimum', '--compatibility'])).toThrow(/option/);
  });

  it('resolves minimum from the manifest and follows a changed support floor', () => {
    expect(resolveVSCodeTestVersion(manifest, 'minimum')).toEqual({
      version: '1.85.0', minimum: '1.85.0', expectedVersion: '1.85.0',
    });
    expect(resolveVSCodeTestVersion({ engines: { vscode: '^1.100.2' } }, 'minimum').version)
      .toBe('1.100.2');
  });

  it('preserves stable, insiders, and explicit diagnostic versions', () => {
    expect(resolveVSCodeTestVersion(manifest)).toEqual({
      version: 'stable', minimum: '1.85.0', expectedVersion: '',
    });
    expect(resolveVSCodeTestVersion(manifest, 'insiders').expectedVersion).toBe('');
    expect(resolveVSCodeTestVersion(manifest, '1.90.2').expectedVersion).toBe('1.90.2');
  });

  it('rejects missing or ambiguous support floors instead of guessing or falling back', () => {
    for (const value of [null, [], {}, { engines: null }, { engines: { vscode: 185 } },
      { engines: { vscode: '*' } }, { engines: { vscode: '>=1.85.0' } },
      { engines: { vscode: '^1.85.0 || ^2.0.0' } }]) {
      expect(() => resolveVSCodeTestVersion(value, 'minimum')).toThrow(/engines.vscode/);
    }
  });

  it('rejects malformed requested versions rather than running stable silently', () => {
    for (const value of ['', 'Minimum', '1.85', 'v1.85.0', '1.085.0', 'latest', null]) {
      expect(() => resolveVSCodeTestVersion(manifest, value)).toThrow(/version/);
    }
  });
});
