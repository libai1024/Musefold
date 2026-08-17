import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_DATA_NAMESPACE,
  APP_NAME,
  BACKUPS_DIR_NAME,
  DB_NAME,
  LOCAL_STORAGE_PREFIX,
  LOGS_DIR_NAME,
  PICTURES_DIR_NAME,
  PREVIEWS_DIR_NAME,
  STORE_NAME,
} from '../constants';
import { EXPORT_FORMAT, EXPORT_JSON_NAME, validateEnvelope } from '../export-format';
import { SHARE_PROTOCOL, parseShareDeeplink } from '../share';

const builder = readFileSync('electron-builder.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name: string;
  version: string;
  author: string;
  scripts: Record<string, string>;
};
const bootstrap = readFileSync('electron/main/index.ts', 'utf8');
const sessionPreferences = readFileSync(
  'src/features/generation/workbench/sessionPreferences.ts',
  'utf8',
);
const visibleUi = [
  'src/index.html',
  'src/components/layout/Sidebar.tsx',
  'src/features/onboarding/OnboardingFlow.tsx',
  'src/features/generation/workbench/GenerationWorkbench.tsx',
  'src/features/design-schemes/DesignSchemesPage.tsx',
].map((path) => readFileSync(path, 'utf8')).join('\n');

const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs',
  '.py', '.ts', '.tsx', '.yaml', '.yml',
]);

function readProductText(path: string): string {
  return readdirSync(path, { withFileTypes: true }).map((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return readProductText(child);
    if (!textExtensions.has(extname(entry.name))) return '';
    return readFileSync(child, 'utf8');
  }).join('\n');
}

describe('Musefold brand boundary', () => {
  it('uses Musefold for product, package, and visible UI identities', () => {
    expect(APP_NAME).toBe('Musefold');
    // v0.4（D9）：npm 包名 musefold 保留给 CLI；根应用包是私有的 musefold-app。
    expect(packageJson.name).toBe('musefold-app');
    // 具体版本号由发布流程管理；守卫只挡住旧品牌形态的版本串。
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(-dev)?$/);
    expect(packageJson.author).toBe('Musefold');
    expect(builder).toMatch(/^appId:\s*com\.musefold\.app$/m);
    expect(builder).toMatch(/^productName:\s*Musefold$/m);
    expect(packageJson.scripts['package:mac:adhoc']).toContain('Musefold.app');
    expect(visibleUi).toContain('Musefold');
  });

  it('uses an isolated Musefold v0.3.0 data domain with no directory fallback', () => {
    expect(APP_DATA_NAMESPACE).toBe('v0.3.0');
    expect(DB_NAME).toBe('musefold-data-v0.3.0.db');
    expect(STORE_NAME).toBe('musefold-providers-v0.3.0');
    expect(LOCAL_STORAGE_PREFIX).toBe('musefold:v0.3.0:');
    expect(PICTURES_DIR_NAME).toBe('Musefold/v0.3.0');
    expect(BACKUPS_DIR_NAME).toBe('musefold-backups-v0.3.0');
    expect(PREVIEWS_DIR_NAME).toBe('musefold-previews-v0.3.0');
    expect(LOGS_DIR_NAME).toBe('musefold-logs-v0.3.0');
    expect(sessionPreferences).toContain('LOCAL_STORAGE_PREFIX');
    expect(sessionPreferences).not.toContain(['musefold:v0', '.2.2:'].join(''));
    // 启动文件对 appData 的引用只允许一处：开发态把 userData 钉在 musefold 域
    // （根包更名 musefold-app 后防漂移，v0.4）。不得出现任何目录回退逻辑。
    expect(bootstrap.match(/app\.getPath\('appData'\)/g) ?? []).toHaveLength(1);
    expect(bootstrap).toContain("app.setPath('userData', join(app.getPath('appData'), 'musefold'))");
  });

  it('accepts only Musefold protocol and exchange formats', () => {
    const formerSlug = ['prompt', 'forge'].join('');

    expect(SHARE_PROTOCOL).toBe('musefold');
    expect(EXPORT_FORMAT).toBe('musefold-export');
    expect(EXPORT_JSON_NAME).toBe('musefold-export.json');
    expect(() => parseShareDeeplink(`${formerSlug}://import?data=abc`)).toThrow(/INVALID_DEEPLINK/);
    expect(validateEnvelope({
      format: `${formerSlug}-export`,
      schemaVersion: 1,
      data: {},
    }).ok).toBe(false);

  });

  it('contains no former brand or abbreviated runtime identifiers', () => {
    const formerBrand = ['Prompt', 'Forge'].join('');
    const formerEnvPrefix = ['P', 'F_'].join('');
    const formerGlobalPrefix = ['__p', 'f'].join('');
    const productText = [
      ...['src', 'electron', 'shared', 'packages', 'scripts', 'preview', 'tests', '.github'].map(readProductText),
      readFileSync('README.md', 'utf8'),
      readFileSync('package.json', 'utf8'),
      readFileSync('package-lock.json', 'utf8'),
      builder,
    ].join('\n');

    expect(productText.toLowerCase()).not.toContain(formerBrand.toLowerCase());
    expect(productText).not.toContain(formerEnvPrefix);
    expect(productText).not.toContain(formerGlobalPrefix);
  });
});
