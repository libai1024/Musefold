import { X } from "@musefold/ui/icons";

export interface WorkbenchDraftImageItem {
  id: string;
  src: string;
  name?: string;
}

export interface WorkbenchDraftImagesPreviewProps {
  images: WorkbenchDraftImageItem[];
  startIndex?: number;
  onRemove: (index: number) => void;
  onPreview: (index: number) => void;
}

/** Draft/reference image strip. Hosts adapt local paths or remote URLs into `src`. */
export function WorkbenchDraftImagesPreview({
  images,
  startIndex = 1,
  onRemove,
  onPreview,
}: WorkbenchDraftImagesPreviewProps) {
  const supportingRefinement = startIndex > 1;
  return (
    <div
      className="flex min-w-max items-end gap-1.5"
      data-testid="workbench-draft-images"
      data-position="above-composer"
    >
      <span className="shrink-0 self-center px-0.5 text-[10px] text-secondary">
        {supportingRefinement ? "其他图片" : "参考图片"}
      </span>
      {images.map((image, index) => {
        const imageNumber = startIndex + index;
        return (
          <div
            key={image.id}
            className="group relative shrink-0 rounded-md border border-border-subtle bg-inset/55 p-1"
            data-testid="workbench-draft-image"
          >
            <button
              type="button"
              onClick={() => onPreview(index)}
              className="block cursor-zoom-in rounded"
              title={image.name ?? `图 ${imageNumber}`}
              aria-label={`查看图 ${imageNumber}`}
              data-testid="workbench-draft-image-preview"
            >
              <img
                src={image.src}
                alt={`图 ${imageNumber}`}
                className="h-12 w-12 rounded object-contain"
              />
            </button>
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1 py-0.5 text-[8px] leading-none text-white">
              图 {imageNumber}
            </span>
            <button
              type="button"
              onClick={() => onRemove(index)}
              title={`移除图 ${imageNumber}`}
              aria-label={`移除图片 ${imageNumber}`}
              className="no-drag absolute right-0.5 top-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-black/65 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
              data-testid="workbench-draft-image-remove"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
