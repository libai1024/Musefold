import * as YAML from 'yaml';
import type { SkillExecutionPolicy, SkillFileKind } from '@musefold/desktop-contracts/enums';
import { appError, fail, ok, type AppResult } from '@musefold/domain/app-result';

const MAX_FRONTMATTER_LENGTH = 64 * 1024;
const MAX_FRONTMATTER_NODES = 2_000;
const MAX_FRONTMATTER_DEPTH = 32;
const MAX_SKILL_NAME_LENGTH = 240;
const MAX_SKILL_DESCRIPTION_LENGTH = 1_024;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SCRIPT_EXTENSIONS = new Set([
  '.bash', '.bat', '.cmd', '.cjs', '.js', '.mjs', '.ps1', '.py', '.rb', '.sh', '.ts',
]);
const ASSET_EXTENSIONS = new Set([
  '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.pdf', '.png', '.svg', '.webp',
]);
const KNOWN_FRONTMATTER_FIELDS = new Set(['name', 'description', 'license']);

export interface AgentSkillFileInput {
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
  textContent: string | null;
}

export interface ScannedAgentSkillFile extends AgentSkillFileInput {
  fileKind: SkillFileKind;
  executionPolicy: SkillExecutionPolicy;
}

export interface ParsedAgentSkillDocument {
  name: string;
  description: string;
  body: string;
  frontmatter: Record<string, unknown>;
  unknownFrontmatterFields: string[];
  declaredLicense: string | null;
}

export interface AgentSkillScanResult {
  name: string;
  description: string;
  body: string;
  licenseText: string | null;
  metadata: Record<string, unknown>;
  files: ScannedAgentSkillFile[];
}

function scannerError(
  code: Parameters<typeof appError>[0],
  message: string,
  options: Parameters<typeof appError>[2] = {},
): AppResult<never> {
  return fail(appError(code, message, {
    retryable: false,
    recoveryAction: 'select-source',
    ...options,
  }));
}

function normalizeRelativePath(relativePath: string): AppResult<string> {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[a-zA-Z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))
  ) {
    return scannerError('INVALID_TYPE', `Skill 文件路径不安全：${relativePath}`, {
      fieldPath: 'files.relativePath',
      details: { relativePath },
    });
  }
  return ok(normalized);
}

function extension(relativePath: string): string {
  const base = relativePath.split('/').at(-1) ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export function classifyAgentSkillFile(relativePath: string): SkillFileKind {
  const normalized = relativePath.replaceAll('\\', '/');
  const lower = normalized.toLowerCase();
  const segments = lower.split('/');
  const base = segments.at(-1) ?? '';
  const first = segments[0] ?? '';
  if (normalized === 'SKILL.md') return 'skill_md';
  if (/^(licen[cs]e|copying|notice)(\.[a-z0-9_-]+)?$/i.test(base)) return 'license';
  if (first === 'scripts' || SCRIPT_EXTENSIONS.has(extension(lower))) return 'script';
  if (first === 'assets' || ASSET_EXTENSIONS.has(extension(lower))) return 'asset';
  if (first === 'references') return 'reference';
  return 'other';
}

function inspectFrontmatterAst(document: YAML.Document): AppResult<null> {
  let nodeCount = 0;
  let violation: AppResult<never> | null = null;
  YAML.visit(document, {
    Node(_key, node, path) {
      nodeCount += 1;
      if (nodeCount > MAX_FRONTMATTER_NODES) {
        violation = scannerError('TOO_MANY_ITEMS', 'SKILL.md frontmatter 结构过于复杂', {
          details: { maxNodes: MAX_FRONTMATTER_NODES },
        });
        return YAML.visit.BREAK;
      }
      if (path.length > MAX_FRONTMATTER_DEPTH) {
        violation = scannerError('INVALID_RANGE', 'SKILL.md frontmatter 嵌套层级过深', {
          details: { maxDepth: MAX_FRONTMATTER_DEPTH },
        });
        return YAML.visit.BREAK;
      }
      if (YAML.isAlias(node) || (node as { anchor?: unknown }).anchor) {
        violation = scannerError('INVALID_TYPE', 'SKILL.md frontmatter 不支持 YAML 锚点或别名');
        return YAML.visit.BREAK;
      }
      if (node.tag) {
        violation = scannerError('INVALID_TYPE', 'SKILL.md frontmatter 不支持 YAML 自定义标签', {
          details: { tag: node.tag },
        });
        return YAML.visit.BREAK;
      }
      return undefined;
    },
  });
  return violation ?? ok(null);
}

function validateJsonValue(value: unknown, path: string): AppResult<null> {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return ok(null);
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? ok(null)
      : scannerError('INVALID_TYPE', `SKILL.md frontmatter 包含无效数字：${path}`, { fieldPath: path });
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const child = validateJsonValue(value[index], `${path}.${index}`);
      if (!child.ok) return child;
    }
    return ok(null);
  }
  if (!value || typeof value !== 'object') {
    return scannerError('INVALID_TYPE', `SKILL.md frontmatter 字段不是安全数据：${path}`, { fieldPath: path });
  }
  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) {
      return scannerError('INVALID_TYPE', `SKILL.md frontmatter 包含不安全字段：${key}`, {
        fieldPath: `${path}.${key}`,
      });
    }
    const child = validateJsonValue(childValue, `${path}.${key}`);
    if (!child.ok) return child;
  }
  return ok(null);
}

function frontmatterRange(markdown: string): AppResult<{ yamlText: string; body: string }> {
  const source = markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown;
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return scannerError('REQUIRED', 'SKILL.md 缺少 YAML frontmatter', { fieldPath: 'SKILL.md.frontmatter' });
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closingIndex < 0) {
    return scannerError('INVALID_TYPE', 'SKILL.md frontmatter 缺少结束标记', {
      fieldPath: 'SKILL.md.frontmatter',
    });
  }
  return ok({
    yamlText: lines.slice(1, closingIndex).join('\n'),
    body: lines.slice(closingIndex + 1).join('\n'),
  });
}

export function parseAgentSkillMarkdown(markdown: string): AppResult<ParsedAgentSkillDocument> {
  if (!markdown.trim()) return scannerError('REQUIRED', 'SKILL.md 内容不能为空', { fieldPath: 'SKILL.md' });
  const range = frontmatterRange(markdown);
  if (!range.ok) return range;
  if (range.data.yamlText.length > MAX_FRONTMATTER_LENGTH) {
    return scannerError('STRING_TOO_LONG', 'SKILL.md frontmatter 过长', {
      fieldPath: 'SKILL.md.frontmatter',
      recoveryAction: 'shorten-input',
      details: { maxBytes: MAX_FRONTMATTER_LENGTH },
    });
  }

  let document: YAML.Document;
  try {
    document = YAML.parseDocument(range.data.yamlText, {
      schema: 'core',
      prettyErrors: false,
      uniqueKeys: true,
    });
  } catch (error) {
    return scannerError('INVALID_TYPE', `SKILL.md frontmatter 解析失败：${error instanceof Error ? error.message : '未知错误'}`);
  }
  if (document.errors.length > 0 || document.warnings.length > 0) {
    const issue = document.errors[0] ?? document.warnings[0];
    return scannerError('INVALID_TYPE', `SKILL.md frontmatter 解析失败：${issue?.message ?? '未知错误'}`, {
      fieldPath: 'SKILL.md.frontmatter',
    });
  }
  const ast = inspectFrontmatterAst(document);
  if (!ast.ok) return ast;
  if (!YAML.isMap(document.contents)) {
    return scannerError('INVALID_TYPE', 'SKILL.md frontmatter 必须是键值对象', {
      fieldPath: 'SKILL.md.frontmatter',
    });
  }

  let frontmatter: unknown;
  try {
    frontmatter = document.toJSON();
  } catch (error) {
    return scannerError('INVALID_TYPE', `SKILL.md frontmatter 无法转换为安全数据：${error instanceof Error ? error.message : '未知错误'}`);
  }
  const safeValue = validateJsonValue(frontmatter, 'SKILL.md.frontmatter');
  if (!safeValue.ok) return safeValue;
  const fields = frontmatter as Record<string, unknown>;
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  const description = typeof fields.description === 'string' ? fields.description.trim() : '';
  if (!name) {
    return scannerError('REQUIRED', 'SKILL.md frontmatter 缺少 name', {
      fieldPath: 'SKILL.md.frontmatter.name',
    });
  }
  if (!description) {
    return scannerError('REQUIRED', 'SKILL.md frontmatter 缺少 description', {
      fieldPath: 'SKILL.md.frontmatter.description',
    });
  }
  // eslint-disable-next-line no-control-regex -- 故意匹配 C0/DEL，拒绝 skill name 含不可见控制字符
  if (name.length > MAX_SKILL_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    return scannerError('INVALID_TYPE', 'SKILL.md name 格式不正确或过长', {
      fieldPath: 'SKILL.md.frontmatter.name',
      details: { maxLength: MAX_SKILL_NAME_LENGTH },
    });
  }
  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    return scannerError('STRING_TOO_LONG', 'SKILL.md description 过长', {
      fieldPath: 'SKILL.md.frontmatter.description',
      recoveryAction: 'shorten-input',
      details: { maxLength: MAX_SKILL_DESCRIPTION_LENGTH },
    });
  }
  if (fields.license !== undefined && typeof fields.license !== 'string') {
    return scannerError('INVALID_TYPE', 'SKILL.md license 必须是文本', {
      fieldPath: 'SKILL.md.frontmatter.license',
    });
  }

  return ok({
    name,
    description,
    body: range.data.body,
    frontmatter: fields,
    unknownFrontmatterFields: Object.keys(fields).filter((key) => !KNOWN_FRONTMATTER_FIELDS.has(key)).sort(),
    declaredLicense: typeof fields.license === 'string' && fields.license.trim() ? fields.license.trim() : null,
  });
}

export function scanAgentSkillFiles(inputFiles: ReadonlyArray<AgentSkillFileInput>): AppResult<AgentSkillScanResult> {
  const seenPaths = new Set<string>();
  const files: ScannedAgentSkillFile[] = [];
  for (const input of inputFiles) {
    const normalized = normalizeRelativePath(input.relativePath);
    if (!normalized.ok) return normalized;
    if (seenPaths.has(normalized.data)) {
      return scannerError('DUPLICATE_KEY', `Skill 包含重复文件路径：${normalized.data}`, {
        fieldPath: 'files.relativePath',
      });
    }
    if (!input.contentHash.trim() || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
      return scannerError('INVALID_TYPE', `Skill 文件元数据无效：${normalized.data}`, {
        fieldPath: 'files',
      });
    }
    seenPaths.add(normalized.data);
    const fileKind = classifyAgentSkillFile(normalized.data);
    files.push({
      relativePath: normalized.data,
      contentHash: input.contentHash,
      sizeBytes: input.sizeBytes,
      textContent: fileKind === 'asset' ? null : input.textContent,
      fileKind,
      executionPolicy: 'never',
    });
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));

  const skillFile = files.find((file) => file.relativePath === 'SKILL.md');
  if (!skillFile) {
    return scannerError('MISSING_REFERENCE', '所选来源的根目录中没有 SKILL.md', {
      fieldPath: 'files.SKILL.md',
    });
  }
  if (skillFile.textContent === null) {
    return scannerError('INVALID_TYPE', 'SKILL.md 不是可读取的 UTF-8 文本', {
      fieldPath: 'files.SKILL.md',
    });
  }
  const parsed = parseAgentSkillMarkdown(skillFile.textContent);
  if (!parsed.ok) return parsed;

  const licenseFiles = files
    .filter((file) => file.fileKind === 'license' && file.textContent?.trim())
    .sort((left, right) => left.relativePath.length - right.relativePath.length || left.relativePath.localeCompare(right.relativePath));
  const licenseText = licenseFiles[0]?.textContent?.trim() || parsed.data.declaredLicense;
  const scriptFiles = files.filter((file) => file.fileKind === 'script');

  return ok({
    name: parsed.data.name,
    description: parsed.data.description,
    body: parsed.data.body,
    licenseText,
    metadata: {
      format: 'agent-skills-safe-subset',
      declaredFrontmatter: parsed.data.frontmatter,
      unknownFrontmatterFields: parsed.data.unknownFrontmatterFields,
      bodyLength: parsed.data.body.length,
      scriptFileCount: scriptFiles.length,
      safety: {
        metadataAuthority: 'none',
        scriptsExecutable: false,
        executionPolicy: 'never',
      },
    },
    files,
  });
}
