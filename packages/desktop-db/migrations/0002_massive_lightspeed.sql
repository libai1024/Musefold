ALTER TABLE `generation_runs` ADD `prompt_id` text;--> statement-breakpoint
CREATE INDEX `idx_generation_runs_prompt_created` ON `generation_runs` (`prompt_id`,`created_at`) WHERE prompt_id IS NOT NULL;--> statement-breakpoint
-- 单账本回填(V25 生命周期决议:generation_runs 是唯一生成账本):
-- history 旧行按同 id 迁入 generation_runs;双写期两边同 id,已存在的跳过(幂等)。
-- 语义映射:
--   * created_at:旧 history 在生成完成时写入,故同时充当 finished_at;started_at 留空(未知)。
--   * cost:cost_unit='point' 原值即积分;'cny_cent'(BYOK 分)换算为元(÷100)。
--   * 空 prompt/provider/model 用占位符满足 CHECK 约束;非法 status 归并为 failed。
--   * history_prompt_references 内嵌进 prompt_snapshot_json.promptReferences(快照语义不变)。
INSERT INTO generation_runs (
  id, run_kind, prompt_id, provider_id, model,
  user_prompt, base_prompt, final_prompt, negative_prompt,
  params_json, prompt_snapshot_json,
  status, error_code, error_message, actual_cost, duration_ms,
  created_at, finished_at
)
SELECT
  h.id,
  'free_generation',
  h.prompt_id,
  CASE WHEN length(trim(h.provider_id)) > 0 THEN h.provider_id ELSE 'unknown' END,
  CASE WHEN length(trim(h.model)) > 0 THEN h.model ELSE 'unknown' END,
  h.prompt_text,
  CASE WHEN length(trim(h.prompt_text)) > 0 THEN h.prompt_text ELSE '(未记录提示词)' END,
  CASE WHEN length(trim(h.prompt_text)) > 0 THEN h.prompt_text ELSE '(未记录提示词)' END,
  h.negative_text,
  CASE WHEN h.params IS NOT NULL AND json_valid(h.params) THEN h.params ELSE '{"schemaVersion":1}' END,
  json_object(
    'schemaVersion', 1,
    'userPrompt', h.prompt_text,
    'basePrompt', CASE WHEN length(trim(h.prompt_text)) > 0 THEN h.prompt_text ELSE '(未记录提示词)' END,
    'refinementInstruction', NULL,
    'finalPrompt', CASE WHEN length(trim(h.prompt_text)) > 0 THEN h.prompt_text ELSE '(未记录提示词)' END,
    'negativePrompt', h.negative_text,
    'promptReferences', json(COALESCE((
      SELECT json_group_array(json_object(
        'promptId', r.prompt_id,
        'title', r.prompt_title,
        'excerpt', r.excerpt,
        'scope', r.scope
      ) ORDER BY r.sort_order)
      FROM history_prompt_references r
      WHERE r.history_id = h.id
    ), '[]'))
  ),
  CASE WHEN h.status IN ('success', 'failed', 'cancelled') THEN h.status ELSE 'failed' END,
  h.error_code,
  h.error_message,
  CASE
    WHEN h.cost IS NULL THEN NULL
    WHEN h.cost_unit = 'cny_cent' THEN h.cost / 100.0
    ELSE h.cost
  END,
  h.duration_ms,
  h.created_at,
  h.created_at
FROM history h
WHERE NOT EXISTS (SELECT 1 FROM generation_runs gr WHERE gr.id = h.id);--> statement-breakpoint
-- 成功行的出图落为 position 0 资产(资产 id 沿用 run id,与 runs.complete 的约定一致)。
INSERT INTO generated_assets (id, run_id, position, status, media_path, created_at)
SELECT h.id, h.id, 0, 'available', h.image_path, h.created_at
FROM history h
WHERE h.image_path IS NOT NULL
  AND h.status = 'success'
  AND NOT EXISTS (SELECT 1 FROM generated_assets ga WHERE ga.run_id = h.id AND ga.position = 0)
  AND NOT EXISTS (SELECT 1 FROM generated_assets ga2 WHERE ga2.id = h.id);
