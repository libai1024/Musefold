import type { HistoryRecord } from '@musefold/desktop-contracts/models';

export function promptRelationLabel(item: HistoryRecord): string {
  const relations = item.promptRelations ?? [];
  const direct = relations.some((relation) => relation.kind === 'source');
  const saved = relations.some((relation) => relation.kind === 'saved');
  const references = relations.filter((relation) => relation.kind === 'reference');
  if (saved) return '由作品保存';
  if (direct && references.length > 0) return `直接制作 + 引用 ${references.length} 处`;
  if (direct) return '直接制作';
  if (references.length > 1) return `引用 ${references.length} 处`;
  if (references[0]?.scope === 'excerpt') return '引用选段';
  if (references[0]?.scope === 'full') return '引用整条';
  return '关联作品';
}
