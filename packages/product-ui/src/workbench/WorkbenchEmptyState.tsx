import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@musefold/ui";
import { ChevronDown, Sparkles } from "@musefold/ui/icons";
import { useTheaterIdle } from "./useTheaterIdle";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  useTheaterIdle(rootRef, 160);

  const items = useMemo(() => {
    const source = suggestions.length > 0 ? suggestions : DEFAULT_SUGGESTIONS;
    return source.slice(0, 6);
  }, [suggestions]);
  const primary = items[0];
  const starters = items.slice(0, 3);
  const moreDirections = items.slice(3);

  return (
    <div
      ref={rootRef}
      className="mf-workbench-empty"
      data-testid="workbench-empty"
      data-ui-register="theater"
    >
      <div className="mf-workbench-empty-copy" data-brand-slogan>
        <h2 data-testid="workbench-empty-slogan">
          让灵感<span className="mf-workbench-empty-accent">成为图像。</span>
        </h2>
        <p>从一张图、一段文字或一个方向开始</p>
        <Button
          unstyled
          type="button"
          className="mf-workbench-empty-cta"
          data-testid="workbench-empty-cta"
          onClick={() => primary && onSelectSuggestion?.(primary)}
        >
          <Sparkles aria-hidden="true" />
          从这条开始
        </Button>
      </div>
      <div className="mf-workbench-empty-brand" data-brand-hero>
        {brand}
      </div>
      <div
        className="mf-workbench-directions"
        aria-label="创作方向"
        data-testid="generation-directions"
      >
        {starters.map((suggestion) => (
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
        {moreDirections.length > 0 && (
          <>
            <Button
              unstyled
              type="button"
              className="mf-workbench-directions-toggle"
              aria-expanded={directionsOpen}
              onClick={() => setDirectionsOpen((open) => !open)}
              data-testid="generation-directions-toggle"
            >
              浏览灵感
              <ChevronDown
                aria-hidden="true"
                className={directionsOpen ? "rotate-180" : undefined}
              />
            </Button>
            {directionsOpen &&
              moreDirections.map((suggestion) => (
                <Button
                  unstyled
                  type="button"
                  className="mf-workbench-direction-item"
                  key={suggestion}
                  onClick={() => onSelectSuggestion?.(suggestion)}
                  title={suggestion}
                >
                  {suggestion}
                </Button>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
