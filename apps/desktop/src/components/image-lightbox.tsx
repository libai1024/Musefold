// 桌面图像预览适配：共享 ImageLightbox + 本地路径/IPC/toast。
import { ImageLightbox as SharedImageLightbox } from '@musefold/ui';
import { toImageSrc } from '../lib/media';
import api from '../lib/ipc';
import { toast } from '../stores/toast';

interface Props {
  path: string | null;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  prompt?: string | null;
}

export function ImageLightbox({
  path,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  prompt,
}: Props) {
  const src = path ? toImageSrc(path) : null;

  const saveImage = async () => {
    if (!path) return;
    try {
      const result = await api.system.saveImage(path);
      if ('cancelled' in result) return;
      toast.success('图片已另存');
    } catch (error) {
      toast.error('另存失败', error instanceof Error ? error.message : '图片可能已被移动或删除。');
    }
  };

  const openFolder = async () => {
    if (!path) return;
    try {
      await api.system.openInFolder(path);
      toast.success('已在文件夹中定位图片');
    } catch (error) {
      toast.error('打开文件夹失败', error instanceof Error ? error.message : '图片可能已被移动或删除。');
    }
  };

  const copyImage = async () => {
    if (!path) return;
    try {
      await api.system.copyImage(path);
      toast.success('已复制图片');
    } catch (error) {
      toast.error('复制图片失败', error instanceof Error ? error.message : '图片可能已被移动或删除。');
    }
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success('已复制提示词');
    } catch {
      toast.error('复制失败', '剪贴板不可用');
    }
  };

  return (
    <SharedImageLightbox
      src={src}
      onClose={onClose}
      onPrevious={onPrevious}
      onNext={onNext}
      hasPrevious={hasPrevious}
      hasNext={hasNext}
      prompt={prompt}
      onSave={saveImage}
      onReveal={openFolder}
      onCopyImage={copyImage}
      onCopyPrompt={copyPrompt}
    />
  );
}
