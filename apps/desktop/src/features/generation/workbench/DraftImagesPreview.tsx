import type { LocalImageReference } from "@musefold/desktop-contracts/providers";
import { WorkbenchDraftImagesPreview } from "@musefold/product-ui";
import { toImageSrc } from "../../../lib/media";

export function DraftImagesPreview({
  images,
  startIndex = 1,
  onRemove,
  onPreview,
}: {
  images: LocalImageReference[];
  startIndex?: number;
  onRemove: (index: number) => void;
  onPreview: (path: string) => void;
}) {
  return (
    <WorkbenchDraftImagesPreview
      images={images.map((image, index) => ({
        id: `${image.source}:${image.historyId ?? image.path}:${index}`,
        src: toImageSrc(image.path),
        name: image.name,
      }))}
      startIndex={startIndex}
      onRemove={onRemove}
      onPreview={(index) => onPreview(images[index].path)}
    />
  );
}
