const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function selectVSCodeTestVersions(args, configuredVersion) {
  if (args.length > 1 || args.some((arg) => arg !== '--minimum' && arg !== '--compatibility')) {
    throw new Error('Use at most one VS Code test option: --minimum or --compatibility.');
  }
  if (args[0] === '--compatibility') return ['minimum', 'stable'];
  return [args[0] === '--minimum' ? 'minimum' : (configuredVersion ?? 'stable')];
}

// Keep the supported range shape explicit: a more complex range needs a reviewed
// minimum-selection policy, not a guessed version or a silent stable fallback.
export function resolveVSCodeTestVersion(manifest, requestedVersion = 'stable') {
  const range = manifest?.engines?.vscode;
  if (typeof range !== 'string' || !range.startsWith('^') || !exactVersion.test(range.slice(1))) {
    throw new Error('package.json engines.vscode must be a single ^major.minor.patch range.');
  }
  const minimum = range.slice(1);
  const version = requestedVersion === 'minimum' ? minimum : requestedVersion;
  if (typeof version !== 'string'
    || (version !== 'stable' && version !== 'insiders' && !exactVersion.test(version))) {
    throw new Error(`Unsupported VS Code test version: ${String(requestedVersion)}`);
  }
  return { version, minimum, expectedVersion: exactVersion.test(version) ? version : '' };
}
