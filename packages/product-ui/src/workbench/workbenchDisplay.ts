export const WORKBENCH_QUALITY_OPTIONS: {
  id: "auto" | "low" | "medium" | "high";
  label: string;
  hint: string;
}[] = [
  { id: "auto", label: "自动", hint: "模型默认" },
  { id: "low", label: "标准", hint: "更快" },
  { id: "medium", label: "高清", hint: "平衡" },
  { id: "high", label: "超清", hint: "细节优先" },
];

export function workbenchFormatParams(params: {
  ratioId: string;
  quality: string;
  n: number;
}): string {
  return `${params.ratioId} · ${params.quality} · ${params.n}张`;
}
