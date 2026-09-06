/**
 * 设置行内段控件(ToggleGroup)的响应式尺寸约定,外观卡与生成参数卡共用。
 *
 * 窄屏(<sm)铺满行宽、字号/内距收一档:三段带图标的组在 390px 视口会超出
 * 卡片内容宽(约 270px)被裁切;sm+ 恢复 w-fit 与常规尺寸,与桌面口径一致。
 */
export const SEGMENT_GROUP_CLASS = 'w-full shrink-0 sm:w-fit';
export const SEGMENT_ITEM_CLASS =
  'flex-1 gap-1.5 px-2 text-xs sm:flex-initial sm:gap-2 sm:px-3 sm:text-sm';
