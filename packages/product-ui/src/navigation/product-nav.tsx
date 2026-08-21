import {
  visibleProductNav,
  type MusefoldSurface,
  type ProductCapabilities,
  type ProductCommandSpec,
} from "@musefold/domain";
import {
  Blocks,
  History,
  LibraryBig,
  MessageSquareText,
  Moon,
  Package,
  PanelLeft,
  Server,
  Settings2,
  SquarePen,
  Sun,
} from "@musefold/ui/icons";
import type { ComponentType } from "react";
import type { ProductSidebarNavItem } from "./ProductSidebar";
import { ProductViewIcon, type ProductViewKey } from "./ProductTopbar";

const PRODUCT_VIEW_KEYS = new Set<ProductViewKey>([
  "generate",
  "library",
  "design-schemes",
  "history",
  "settings",
  "connections",
  "account",
]);

export function resolveProductViewKey(view: string): ProductViewKey {
  if (view === "prompts") return "library";
  if (PRODUCT_VIEW_KEYS.has(view as ProductViewKey)) return view as ProductViewKey;
  return "generate";
}

const COMMAND_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "act-new-conversation": SquarePen,
  "act-import-skill": Package,
  "nav-library": LibraryBig,
  "nav-design-schemes": Blocks,
  "nav-history": History,
  "nav-settings": Settings2,
  "act-providers": Server,
  "act-ai-connections": MessageSquareText,
  "act-sidebar": PanelLeft,
};

export function productCommandIcon(
  id: string,
  theme: "light" | "dark" = "light",
): ComponentType<{ className?: string }> {
  if (id === "act-theme") return theme === "dark" ? Sun : Moon;
  return COMMAND_ICONS[id] ?? SquarePen;
}

export function productCommandLabel(
  spec: ProductCommandSpec,
  theme: "light" | "dark",
): string {
  if (spec.id === "act-theme") {
    return theme === "dark" ? "切换到浅色" : "切换到深色";
  }
  return spec.label;
}

export function buildSidebarNavItems(options: {
  surface: MusefoldSurface;
  capabilities: ProductCapabilities;
  currentView: string;
  onSelect: (sidebarId: string) => void;
  counts?: Readonly<Record<string, number>>;
}): ProductSidebarNavItem[] {
  return visibleProductNav(options.surface, options.capabilities).map((item) => ({
    id: item.sidebarId,
    label: item.label,
    icon: <ProductViewIcon view={resolveProductViewKey(item.sidebarId)} />,
    active: options.currentView === item.sidebarId,
    count: options.counts?.[item.sidebarId],
    onSelect: () => options.onSelect(item.sidebarId),
  }));
}
