'use client';

import type { PromptFolder, PromptTag } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import { Input } from '@musefold/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@musefold/ui/components/popover';
import { Separator } from '@musefold/ui/components/separator';
import { FolderPlus, Settings2, Trash2 } from '@musefold/ui/icons';
import { useState } from 'react';
import { useCreateFolder, useCreateTag, useRemoveFolder, useRemoveTag } from './hooks';

export interface TaxonomyManagerProps {
  folders: PromptFolder[];
  tags: PromptTag[];
}

/** 文件夹/标签目录管理:新建与删除。重命名低频,先不占交互面。 */
export function TaxonomyManager({ folders, tags }: TaxonomyManagerProps) {
  const [folderName, setFolderName] = useState('');
  const [tagName, setTagName] = useState('');
  const createFolder = useCreateFolder();
  const removeFolder = useRemoveFolder();
  const createTag = useCreateTag();
  const removeTag = useRemoveTag();

  function submitFolder() {
    const name = folderName.trim();
    if (!name) return;
    createFolder.mutate(
      { name, parentId: null, sortOrder: folders.length },
      { onSuccess: () => setFolderName('') },
    );
  }

  function submitTag() {
    const name = tagName.trim();
    if (!name) return;
    createTag.mutate({ name, group: null, color: null }, { onSuccess: () => setTagName('') });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="管理文件夹与标签"
          data-testid="taxonomy-open"
        >
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72" data-testid="taxonomy-panel">
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-2 font-medium text-foreground text-sm">文件夹</p>
            <div className="flex gap-1.5">
              <Input
                value={folderName}
                data-testid="taxonomy-folder-name"
                placeholder="新文件夹名"
                maxLength={80}
                onChange={(event) => setFolderName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && submitFolder()}
              />
              <Button
                size="icon"
                variant="secondary"
                aria-label="新建文件夹"
                data-testid="taxonomy-folder-create"
                disabled={!folderName.trim() || createFolder.isPending}
                onClick={submitFolder}
              >
                <FolderPlus className="size-4" />
              </Button>
            </div>
            <ul className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto">
              {folders.map((folder) => (
                <li key={folder.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-foreground">{folder.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 text-muted-foreground"
                    aria-label={`删除文件夹 ${folder.name}`}
                    onClick={() => removeFolder.mutate(folder.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
              {folders.length === 0 && (
                <li className="text-muted-foreground text-xs">暂无文件夹</li>
              )}
            </ul>
          </div>

          <Separator />

          <div>
            <p className="mb-2 font-medium text-foreground text-sm">标签</p>
            <div className="flex gap-1.5">
              <Input
                value={tagName}
                data-testid="taxonomy-tag-name"
                placeholder="新标签名"
                maxLength={40}
                onChange={(event) => setTagName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && submitTag()}
              />
              <Button
                size="icon"
                variant="secondary"
                aria-label="新建标签"
                data-testid="taxonomy-tag-create"
                disabled={!tagName.trim() || createTag.isPending}
                onClick={submitTag}
              >
                <FolderPlus className="size-4" />
              </Button>
            </div>
            <ul className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto">
              {tags.map((tag) => (
                <li key={tag.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-foreground">{tag.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 text-muted-foreground"
                    aria-label={`删除标签 ${tag.name}`}
                    onClick={() => removeTag.mutate(tag.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
              {tags.length === 0 && <li className="text-muted-foreground text-xs">暂无标签</li>}
            </ul>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
