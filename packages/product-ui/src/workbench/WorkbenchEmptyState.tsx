import { useMemo } from "react";
import type { ReactNode } from "react";
import { Button, MusefoldMark } from "@musefold/ui";

const DEFAULT_SUGGESTIONS = [
  "漂浮在云层上的小型图书馆，克制电影感，阴天漫射光，细腻阴影",
  "雨夜东京街角，柔和日系生活方式，低饱和自然光，对角线构图",
  "透明背景护肤品主视觉，柔和反射，高端广告质感",
  "现代建筑外立面摄影，蓝调时刻，几何线条，画面干净",
  "海边旧灯塔与潮湿礁石，雾气轻覆，留出宽阔天空",
  "当代陶器与自然织物，窗边晨光，安静的静物摄影",
  "复古旅行海报，颗粒纸张质感，标题留白，颜色克制",
  "山间民宿的木质客厅，清晨薄雾，层次分明的前中后景",
  "新鲜水果的商业静物图，明亮背景，色彩自然，细节清晰",
  "轻户外服装品牌主视觉，山谷环境，人物自然，留出文案空间",
  "关于慢生活的生活方式海报，手工印刷感，构图平衡",
  "夜色中的社区咖啡馆，暖色窗光，街道反射，叙事感",
];

export interface WorkbenchEmptyStateProps {
  /** 空态内联 Composer(v2.0 11 §3:品牌锁定区与 Composer 共用 760px 中心轴)。 */
  composer?: ReactNode;
  suggestions?: string[];
  onSelectSuggestion?: (suggestion: string) => void;
}

/**
 * v2.0 新对话首屏(docs/v2.0/ui-design/11):品牌锁定区(Logo + 名称 + 换行提示语)
 * + 最多三条低权重快捷建议 + 内联 Composer。不再是营销 Hero:无大插画、无渐变文字、
 * 无独立 CTA;建议只回填草稿,不自动生成。
 */
export function WorkbenchEmptyState({
  composer,
  suggestions = DEFAULT_SUGGESTIONS,
  onSelectSuggestion,
}: WorkbenchEmptyStateProps) {
  const items = useMemo(() => {
    const source = suggestions.length > 0 ? suggestions : DEFAULT_SUGGESTIONS;
    return source.slice(0, 3);
  }, [suggestions]);

  return (
    <div className="mf-workbench-empty" data-testid="workbench-empty">
      <div className="mf-workbench-empty-brand" data-testid="workbench-empty-brand">
        <div className="mf-workbench-empty-brand-line">
          <MusefoldMark aria-hidden="true" focusable="false" />
          <span
            className="mf-workbench-empty-name"
            data-testid="workbench-empty-name"
          >
            Musefold
          </span>
        </div>
        <p
          className="mf-workbench-empty-tagline"
          data-testid="workbench-empty-slogan"
        >
          把想法变成可生成的视觉
        </p>
      </div>
      {items.length > 0 ? (
        <div
          className="mf-workbench-directions"
          aria-label="快捷建议"
          data-testid="generation-directions"
        >
          {items.map((suggestion) => (
            <Button
              unstyled
              type="button"
              className="mf-workbench-direction-item"
              key={suggestion}
              onClick={() => onSelectSuggestion?.(suggestion)}
              title={suggestion}
              data-testid="generation-example"
            >
              {suggestion}
            </Button>
          ))}
        </div>
      ) : null}
      {composer ? (
        <div className="mf-workbench-empty-composer">{composer}</div>
      ) : null}
    </div>
  );
}
