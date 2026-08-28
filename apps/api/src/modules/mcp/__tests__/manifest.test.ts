import { describe, expect, it } from 'vitest';
import {
  CLOUD_MCP_TOOL_MANIFEST,
  CLOUD_MCP_TOOL_NAMES,
  enabledCloudMcpTools,
} from '../manifest.js';

describe('云端 MCP 只读白名单', () => {
  it('保持七个只读工具,与 v2.1 白名单一一对应', () => {
    expect(CLOUD_MCP_TOOL_NAMES).toEqual([
      'musefold_status',
      'get_account_status',
      'list_models',
      'search_prompts',
      'get_prompt',
      'list_skills',
      'get_skill',
    ]);
    expect(CLOUD_MCP_TOOL_MANIFEST.every((entry) => entry.readOnly)).toBe(true);
  });

  it('工具按授权 scope 过滤', () => {
    expect(enabledCloudMcpTools(['prompts:read']).map((entry) => entry.name)).toEqual([
      'search_prompts',
      'get_prompt',
    ]);
    expect(enabledCloudMcpTools([])).toHaveLength(0);
    expect(
      enabledCloudMcpTools(['account:read', 'prompts:read', 'skills:read']).map(
        (entry) => entry.name,
      ),
    ).toEqual([...CLOUD_MCP_TOOL_NAMES]);
  });

  it('白名单里没有任何写操作或生图工具', () => {
    const forbidden = ['create', 'update', 'delete', 'generate', 'write'];
    for (const name of CLOUD_MCP_TOOL_NAMES) {
      for (const keyword of forbidden) {
        expect(name.includes(keyword) && name !== 'get_account_status').toBe(false);
      }
    }
  });
});
