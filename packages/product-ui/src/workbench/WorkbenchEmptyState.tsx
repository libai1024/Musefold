import { useMemo } from "react";
import type { ReactNode } from "react";
import { Button } from "@musefold/ui";

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
  brand: ReactNode;
  suggestions?: string[];
  onSelectSuggestion?: (suggestion: string) => void;
}

export function WorkbenchEmptyState({
  brand,
  suggestions = DEFAULT_SUGGESTIONS,
  onSelectSuggestion,
}: WorkbenchEmptyStateProps) {
  const rows = useMemo(() => {
    const source = suggestions.length >= 12 ? suggestions : DEFAULT_SUGGESTIONS;
    return Array.from({ length: 3 }, (_, index) =>
      source.slice(index * 4, index * 4 + 4),
    );
  }, [suggestions]);

  return (
    <div className="mf-workbench-empty" data-testid="workbench-empty">
      <div className="mf-workbench-empty-brand" data-brand-hero>
        {brand}
      </div>
      <div className="mf-workbench-empty-copy" data-brand-slogan>
        <h2 data-testid="workbench-empty-slogan">让灵感成为图像。</h2>
        <p>从一张图、一段文字或一个方向开始</p>
      </div>
      <div
        className="mf-workbench-directions"
        aria-label="创作方向"
        data-testid="generation-directions"
      >
        {rows.map((row, rowIndex) => (
          <div
            className="mf-workbench-direction-row"
            data-direction-row
            key={rowIndex}
          >
            <div
              className="mf-workbench-direction-ticker"
              data-testid={`generation-directions-ticker-${rowIndex + 1}`}
            >
              {[0, 1].map((group) => (
                <div
                  className="mf-workbench-direction-group"
                  data-direction-group={group === 0 ? rowIndex : undefined}
                  aria-hidden={group === 1 ? true : undefined}
                  key={group}
                >
                  {row.map((suggestion, suggestionIndex) => (
                    <span
                      className="mf-workbench-direction-item"
                      key={`${group}-${suggestion}`}
                    >
                      <Button
                        unstyled
                        type="button"
                        onClick={() => onSelectSuggestion?.(suggestion)}
                        tabIndex={group === 1 ? -1 : 0}
                        title={suggestion}
                        data-testid={
                          group === 0 && suggestionIndex === 0
                            ? "generation-example"
                            : undefined
                        }
                      >
                        {suggestion}
                      </Button>
                      <span aria-hidden="true" />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
