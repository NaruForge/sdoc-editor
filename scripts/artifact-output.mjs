import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const LOCAL_OUTPUT_CONFIG = '.sdoc-output-dir';

function readConfiguredOutputDir(root) {
  const environmentValue = process.env.SDOC_OUTPUT_DIR?.trim();
  if (environmentValue) return environmentValue;

  const localConfigPath = join(root, LOCAL_OUTPUT_CONFIG);
  if (!existsSync(localConfigPath)) return null;
  const localValue = readFileSync(localConfigPath, 'utf8').trim();
  return localValue || null;
}

export function mirrorArtifact(root, artifactPath) {
  const configuredOutputDir = readConfiguredOutputDir(root);
  if (!configuredOutputDir) return null;

  mkdirSync(configuredOutputDir, { recursive: true });
  const mirroredPath = join(configuredOutputDir, basename(artifactPath));
  copyFileSync(artifactPath, mirroredPath);
  console.log(`Artifact copied to: ${mirroredPath}`);
  return mirroredPath;
}
