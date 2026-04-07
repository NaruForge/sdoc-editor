import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

const WINDOWS_PATHS = [
  path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['PROGRAMFILES'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
];

const LINUX_NAMES = [
  'google-chrome-stable',
  'google-chrome',
  'chromium-browser',
  'chromium',
  'microsoft-edge-stable',
  'microsoft-edge',
];

const MACOS_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function whichSync(name: string): string | undefined {
  const pathEnv = process.env['PATH'] || '';
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    const full = path.join(dir, name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch { /* not found */ }
  }
  return undefined;
}

export function detectBrowser(): string | undefined {
  const platform = process.platform;

  if (platform === 'win32') {
    for (const p of WINDOWS_PATHS) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    for (const p of MACOS_PATHS) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    for (const name of LINUX_NAMES) {
      const found = whichSync(name);
      if (found) return found;
    }
  }
  return undefined;
}

export function printToPdf(
  browserPath: string,
  htmlFilePath: string,
  pdfFilePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-software-rasterizer',
      `--print-to-pdf=${pdfFilePath}`,
      '--no-pdf-header-footer',
      htmlFilePath,
    ];

    execFile(browserPath, args, { timeout: 60_000 }, (error: Error | null) => {
      if (error) {
        reject(new Error(`Browser PDF generation failed: ${error.message}`));
      } else {
        resolve();
      }
    });
  });
}
