import { describe, expect, it } from 'vitest';
import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES } from '../capabilities';
import {
  DESIGN_SCHEMES_CAPABILITY_UNAVAILABLE,
  PlatformCapabilityError,
  requireDesignSchemes,
} from '../design-schemes';
import { requireDoubao } from '../doubao';
import type { DesignSchemesGateway, DoubaoGateway } from '../gateway';
import { queryKeys } from '../query-keys';

describe('platform capabilities', () => {
  it('desktop exposes every local host capability', () => {
    expect(DESKTOP_CAPABILITIES).toEqual({
      host: 'desktop',
      canRevealLocalFile: true,
      hasCloudSyncControls: true,
      hasLocalAutomation: true,
      hasWindowChrome: true,
      hasLocalAiProviders: true,
      hasAgentConnections: true,
      // 桌面桥 16 方法 + staging/导入导出已接线,能力真实。
      hasDesignSchemes: true,
      hasDoubaoWebLogin: true,
    });
  });

  it('web exposes no desktop-only capability', () => {
    expect(WEB_CAPABILITIES).toEqual({
      host: 'web',
      canRevealLocalFile: false,
      hasCloudSyncControls: false,
      hasLocalAutomation: false,
      hasWindowChrome: false,
      hasLocalAiProviders: false,
      hasAgentConnections: false,
      // 云端确定性 CRUD/详情/working-draft 已可用,run/市场/导入导出/资产由
      // 服务端结构化 501 fail-closed、UI 就地禁用并解释,生产入口开启。
      hasDesignSchemes: true,
      hasDoubaoWebLogin: false,
    });
  });
  it('returns the adapter only when capability and adapter are both available', () => {
    const adapter = {} as DesignSchemesGateway;
    const enabledCapabilities = { ...DESKTOP_CAPABILITIES, hasDesignSchemes: true };

    expect(requireDesignSchemes(enabledCapabilities, { designSchemes: adapter })).toBe(adapter);
    expect(() => requireDesignSchemes(enabledCapabilities, {})).toThrow(PlatformCapabilityError);
  });

  it('exposes a stable unavailable error when the scheme adapter is not installed', () => {
    expect(() => requireDesignSchemes(WEB_CAPABILITIES, {})).toThrow(PlatformCapabilityError);
    try {
      requireDesignSchemes(WEB_CAPABILITIES, {});
    } catch (error) {
      expect(error).toMatchObject({
        code: DESIGN_SCHEMES_CAPABILITY_UNAVAILABLE,
        capability: 'hasDesignSchemes',
      });
    }

    const disabledCapabilities = { ...DESKTOP_CAPABILITIES, hasDesignSchemes: false };
    expect(() =>
      requireDesignSchemes(disabledCapabilities, { designSchemes: {} as never }),
    ).toThrow(/hasDesignSchemes/);
  });

  it('resolves the doubao adapter only when capability and adapter agree', () => {
    const adapter = {} as DoubaoGateway;
    expect(requireDoubao(DESKTOP_CAPABILITIES, { doubao: adapter })).toBe(adapter);

    // Web 永不提供豆包登录:capability false 时即使装了 adapter 也拒绝解析。
    expect(() => requireDoubao(WEB_CAPABILITIES, { doubao: adapter })).toThrow(
      PlatformCapabilityError,
    );
    try {
      requireDoubao(WEB_CAPABILITIES, { doubao: adapter });
    } catch (error) {
      expect(error).toMatchObject({
        code: DESIGN_SCHEMES_CAPABILITY_UNAVAILABLE,
        capability: 'hasDoubaoWebLogin',
      });
    }

    // 桌面 capability 开但宿主未装 adapter:同样显式失败,不产生静默死入口。
    expect(() => requireDoubao(DESKTOP_CAPABILITIES, {})).toThrow(/hasDoubaoWebLogin/);
  });
});

describe('query keys', () => {
  it('produces stable hierarchical keys for every factory', () => {
    expect(queryKeys.settings.preferences()).toEqual(['settings', 'preferences']);
    expect(queryKeys.account.status()).toEqual(['account', 'status']);
    expect(queryKeys.aiProviders.list()).toEqual(['ai-providers', 'list']);
    expect(queryKeys.sync.status()).toEqual(['sync', 'status']);
    expect(queryKeys.sync.conflicts()).toEqual(['sync', 'conflicts']);
    expect(queryKeys.doubao.status()).toEqual(['doubao', 'status']);

    const schemeQuery = { status: 'draft' as const, limit: 20 };
    const marketQuery = { query: 'poster', limit: 10 };
    expect(queryKeys.designSchemes.all()).toEqual(['design-schemes']);
    expect(queryKeys.designSchemes.list(schemeQuery)).toEqual([
      'design-schemes',
      'list',
      schemeQuery,
    ]);
    expect(queryKeys.designSchemes.detail('scheme-1')).toEqual([
      'design-schemes',
      'detail',
      'scheme-1',
      { kind: 'current' },
    ]);
    expect(queryKeys.designSchemes.marketSearch(marketQuery)).toEqual([
      'design-schemes',
      'market-search',
      marketQuery,
    ]);
    expect(
      queryKeys.designSchemes.detail('scheme-1', {
        kind: 'working-draft',
        revisionId: 'revision-2',
      }),
    ).toEqual([
      'design-schemes',
      'detail',
      'scheme-1',
      { kind: 'working-draft', revisionId: 'revision-2' },
    ]);

    expect(queryKeys.prompts.all()).toEqual(['prompts']);
    expect(queryKeys.prompts.list({ q: 'cat' })).toEqual(['prompts', 'list', { q: 'cat' }]);
    expect(queryKeys.prompts.detail('p1')).toEqual(['prompts', 'detail', 'p1']);
    expect(queryKeys.prompts.folders()).toEqual(['prompts', 'folders']);
    expect(queryKeys.prompts.tags()).toEqual(['prompts', 'tags']);

    expect(queryKeys.workbench.all()).toEqual(['workbench']);
    expect(queryKeys.workbench.sessions({ archivedOnly: true })).toEqual([
      'workbench',
      'sessions',
      { archivedOnly: true },
    ]);
    expect(queryKeys.workbench.session('s1')).toEqual(['workbench', 'session', 's1']);

    expect(queryKeys.generation.all()).toEqual(['generation']);
    expect(queryKeys.generation.list({})).toEqual(['generation', 'list', {}]);
    expect(queryKeys.generation.history({})).toEqual(['generation', 'history', {}]);
    expect(queryKeys.generation.detail('g1')).toEqual(['generation', 'detail', 'g1']);
    expect(queryKeys.generation.providers()).toEqual(['generation', 'providers']);
  });

  it('keeps the same query object in list keys and compares equivalent objects by value', () => {
    const promptQuery = { q: 'cat', tagIds: ['t1'] };
    const sessionQuery = { archivedOnly: true };
    const generationQuery = { sessionId: 's1', includeDeleted: true };

    expect(queryKeys.prompts.list(promptQuery)[2]).toBe(promptQuery);
    expect(queryKeys.workbench.sessions(sessionQuery)[2]).toBe(sessionQuery);
    expect(queryKeys.generation.list(generationQuery)[2]).toBe(generationQuery);
    expect(queryKeys.prompts.list(promptQuery)).toEqual(queryKeys.prompts.list({ ...promptQuery }));
  });

  it('partitions prompt list keys by each query parameter', () => {
    const base = {};
    const queries = [
      { q: 'cat' },
      { cursor: 'cursor-1' },
      { limit: 10 },
      { folderId: 'folder-1' },
      { tagIds: ['tag-1'] },
      { pinnedOnly: true },
      { includeDeleted: true },
      { sort: 'title-asc' as const },
    ];

    for (const query of queries) {
      expect(queryKeys.prompts.list(query)).not.toEqual(queryKeys.prompts.list(base));
    }
  });

  it('partitions workbench session keys by each query parameter', () => {
    const base = {};
    const queries = [
      { cursor: 'cursor-1' },
      { limit: 10 },
      { includeArchived: true },
      { includeDeleted: true },
      { archivedOnly: true },
    ];

    for (const query of queries) {
      expect(queryKeys.workbench.sessions(query)).not.toEqual(queryKeys.workbench.sessions(base));
    }
  });

  it('partitions generation list keys by each query parameter', () => {
    const base = {};
    const queries = [
      { cursor: 'cursor-1' },
      { limit: 10 },
      { sessionId: 'session-1' },
      { status: 'queued' as const },
      { from: '2026-08-01T00:00:00+00:00' },
      { to: '2026-08-02T00:00:00+00:00' },
      { providerModel: 'model-1' },
      { search: 'cat' },
      { includeDeleted: true },
      { deletedOnly: true },
    ];

    for (const query of queries) {
      expect(queryKeys.generation.list(query)).not.toEqual(queryKeys.generation.list(base));
    }
  });

  it('uses each all key as the invalidation prefix for its domain', () => {
    const prefixCases = [
      {
        prefix: queryKeys.prompts.all(),
        keys: [
          queryKeys.prompts.list({}),
          queryKeys.prompts.detail('p1'),
          queryKeys.prompts.folders(),
          queryKeys.prompts.tags(),
        ],
      },
      {
        prefix: queryKeys.workbench.all(),
        keys: [queryKeys.workbench.sessions({}), queryKeys.workbench.session('s1')],
      },
      {
        prefix: queryKeys.designSchemes.all(),
        keys: [
          queryKeys.designSchemes.list({}),
          queryKeys.designSchemes.detail('scheme-1'),
          queryKeys.designSchemes.marketSearch({ query: 'poster' }),
        ],
      },
      {
        prefix: queryKeys.generation.all(),
        keys: [
          queryKeys.generation.list({}),
          queryKeys.generation.history({}),
          queryKeys.generation.detail('g1'),
          queryKeys.generation.providers(),
        ],
      },
    ] as const;

    for (const { prefix, keys } of prefixCases) {
      for (const key of keys) {
        expect(key.slice(0, prefix.length)).toEqual(prefix);
      }
    }
  });

  it('partitions design scheme list keys by each query parameter', () => {
    const base = {};
    const queries = [
      { query: 'poster' },
      { status: 'draft' as const },
      { fidelity: 'verified' as const },
      { cursor: 'cursor-1' },
      { limit: 10 },
    ];

    for (const query of queries) {
      expect(queryKeys.designSchemes.list(query)).not.toEqual(queryKeys.designSchemes.list(base));
    }
  });

  it('keeps design scheme query partitions distinct and preserves query references', () => {
    const listQuery = { status: 'draft' as const };
    const marketQuery = { query: 'poster' };
    expect(queryKeys.designSchemes.list(listQuery)[2]).toBe(listQuery);
    expect(queryKeys.designSchemes.marketSearch(marketQuery)[2]).toBe(marketQuery);
    expect(queryKeys.designSchemes.list(listQuery)).not.toEqual(
      queryKeys.designSchemes.marketSearch(marketQuery),
    );
  });
  it('partitions detail keys by current and exact working-draft revisions', () => {
    expect(queryKeys.designSchemes.detail('scheme-1')).not.toEqual(
      queryKeys.designSchemes.detail('scheme-1', {
        kind: 'working-draft',
        revisionId: 'revision-2',
      }),
    );
    expect(
      queryKeys.designSchemes.detail('scheme-1', {
        kind: 'working-draft',
        revisionId: 'revision-2',
      }),
    ).not.toEqual(
      queryKeys.designSchemes.detail('scheme-1', {
        kind: 'working-draft',
        revisionId: 'revision-3',
      }),
    );
  });

  it('keeps generation list and history keys distinct', () => {
    const query = { sessionId: 'session-1', limit: 20 };
    const listKey = queryKeys.generation.list(query);
    const historyKey = queryKeys.generation.history(query);

    expect(listKey).not.toEqual(historyKey);
    expect(listKey.slice(0, 2)).toEqual(['generation', 'list']);
    expect(historyKey.slice(0, 2)).toEqual(['generation', 'history']);
    expect(listKey[2]).toBe(query);
    expect(historyKey[2]).toBe(query);
  });
});
