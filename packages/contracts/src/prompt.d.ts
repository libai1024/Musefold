import { z } from 'zod';
export declare const promptTagNameSchema: z.ZodString;
export declare const promptParamsSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
export declare const promptSourceSchema: z.ZodEnum<{
  manual: 'manual';
  import: 'import';
  slip: 'slip';
  share: 'share';
  generation: 'generation';
}>;
export declare const promptTagSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    group: z.ZodNullable<z.ZodString>;
    color: z.ZodNullable<z.ZodString>;
    version: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    deletedAt: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const promptFolderSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    parentId: z.ZodNullable<z.ZodString>;
    sortOrder: z.ZodNumber;
    version: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    deletedAt: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const promptDocumentSchema: z.ZodObject<
  {
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    content: z.ZodString;
    negative: z.ZodNullable<z.ZodString>;
    folderId: z.ZodNullable<z.ZodString>;
    tags: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          name: z.ZodString;
          group: z.ZodNullable<z.ZodString>;
          color: z.ZodNullable<z.ZodString>;
          version: z.ZodNumber;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
          deletedAt: z.ZodNullable<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    modelId: z.ZodNullable<z.ZodString>;
    params: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    rating: z.ZodNumber;
    isPinned: z.ZodBoolean;
    pinOrder: z.ZodNullable<z.ZodNumber>;
    usageCount: z.ZodNumber;
    lastUsedAt: z.ZodNullable<z.ZodString>;
    source: z.ZodEnum<{
      manual: 'manual';
      import: 'import';
      slip: 'slip';
      share: 'share';
      generation: 'generation';
    }>;
    sourceUrl: z.ZodNullable<z.ZodString>;
    version: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    deletedAt: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const newPromptDocumentSchema: z.ZodObject<
  {
    title: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    content: z.ZodString;
    negative: z.ZodNullable<z.ZodString>;
    folderId: z.ZodNullable<z.ZodString>;
    tagIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    modelId: z.ZodNullable<z.ZodString>;
    params: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    rating: z.ZodDefault<z.ZodNumber>;
    isPinned: z.ZodDefault<z.ZodBoolean>;
    pinOrder: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    source: z.ZodDefault<
      z.ZodEnum<{
        manual: 'manual';
        import: 'import';
        slip: 'slip';
        share: 'share';
        generation: 'generation';
      }>
    >;
    sourceUrl: z.ZodDefault<z.ZodNullable<z.ZodString>>;
  },
  z.core.$strip
>;
export declare const updatePromptDocumentSchema: z.ZodObject<
  {
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    content: z.ZodOptional<z.ZodString>;
    negative: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    folderId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tagIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    modelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    params: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    rating: z.ZodOptional<z.ZodNumber>;
    isPinned: z.ZodOptional<z.ZodBoolean>;
    pinOrder: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    source: z.ZodOptional<
      z.ZodEnum<{
        manual: 'manual';
        import: 'import';
        slip: 'slip';
        share: 'share';
        generation: 'generation';
      }>
    >;
    sourceUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expectedVersion: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const newPromptFolderSchema: z.ZodObject<
  {
    name: z.ZodString;
    parentId: z.ZodNullable<z.ZodString>;
    sortOrder: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const updatePromptFolderSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sortOrder: z.ZodOptional<z.ZodNumber>;
    expectedVersion: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const newPromptTagSchema: z.ZodObject<
  {
    name: z.ZodString;
    color: z.ZodNullable<z.ZodString>;
    group: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const updatePromptTagSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    group: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expectedVersion: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const promptListQuerySchema: z.ZodObject<
  {
    q: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<
      z.ZodPipe<
        z.ZodUnion<readonly [z.ZodNumber, z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>]>,
        z.ZodNumber
      >
    >;
    folderId: z.ZodOptional<
      z.ZodUnion<
        readonly [
          z.ZodPipe<z.ZodLiteral<'null'>, z.ZodTransform<null, 'null'>>,
          z.ZodNullable<z.ZodString>,
        ]
      >
    >;
    tagIds: z.ZodOptional<
      z.ZodUnion<
        readonly [z.ZodArray<z.ZodString>, z.ZodPipe<z.ZodString, z.ZodTransform<string[], string>>]
      >
    >;
    pinnedOnly: z.ZodOptional<
      z.ZodUnion<
        readonly [
          z.ZodBoolean,
          z.ZodPipe<
            z.ZodEnum<{
              true: 'true';
              false: 'false';
            }>,
            z.ZodTransform<boolean, 'true' | 'false'>
          >,
        ]
      >
    >;
    includeDeleted: z.ZodDefault<
      z.ZodUnion<
        readonly [
          z.ZodBoolean,
          z.ZodPipe<
            z.ZodEnum<{
              true: 'true';
              false: 'false';
            }>,
            z.ZodTransform<boolean, 'true' | 'false'>
          >,
        ]
      >
    >;
    sort: z.ZodDefault<
      z.ZodEnum<{
        'updated-desc': 'updated-desc';
        'created-desc': 'created-desc';
        'usage-desc': 'usage-desc';
        'title-asc': 'title-asc';
      }>
    >;
  },
  z.core.$strip
>;
export declare const promptPageSchema: z.ZodObject<
  {
    items: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          title: z.ZodString;
          description: z.ZodNullable<z.ZodString>;
          content: z.ZodString;
          negative: z.ZodNullable<z.ZodString>;
          folderId: z.ZodNullable<z.ZodString>;
          tags: z.ZodArray<
            z.ZodObject<
              {
                id: z.ZodString;
                name: z.ZodString;
                group: z.ZodNullable<z.ZodString>;
                color: z.ZodNullable<z.ZodString>;
                version: z.ZodNumber;
                createdAt: z.ZodString;
                updatedAt: z.ZodString;
                deletedAt: z.ZodNullable<z.ZodString>;
              },
              z.core.$strip
            >
          >;
          modelId: z.ZodNullable<z.ZodString>;
          params: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          rating: z.ZodNumber;
          isPinned: z.ZodBoolean;
          pinOrder: z.ZodNullable<z.ZodNumber>;
          usageCount: z.ZodNumber;
          lastUsedAt: z.ZodNullable<z.ZodString>;
          source: z.ZodEnum<{
            manual: 'manual';
            import: 'import';
            slip: 'slip';
            share: 'share';
            generation: 'generation';
          }>;
          sourceUrl: z.ZodNullable<z.ZodString>;
          version: z.ZodNumber;
          createdAt: z.ZodString;
          updatedAt: z.ZodString;
          deletedAt: z.ZodNullable<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    nextCursor: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const promptUseInputSchema: z.ZodObject<
  {
    action: z.ZodEnum<{
      copy: 'copy';
      apply: 'apply';
      generate: 'generate';
    }>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export declare const promptUseResultSchema: z.ZodObject<
  {
    prompt: z.ZodObject<
      {
        id: z.ZodString;
        title: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        content: z.ZodString;
        negative: z.ZodNullable<z.ZodString>;
        folderId: z.ZodNullable<z.ZodString>;
        tags: z.ZodArray<
          z.ZodObject<
            {
              id: z.ZodString;
              name: z.ZodString;
              group: z.ZodNullable<z.ZodString>;
              color: z.ZodNullable<z.ZodString>;
              version: z.ZodNumber;
              createdAt: z.ZodString;
              updatedAt: z.ZodString;
              deletedAt: z.ZodNullable<z.ZodString>;
            },
            z.core.$strip
          >
        >;
        modelId: z.ZodNullable<z.ZodString>;
        params: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        rating: z.ZodNumber;
        isPinned: z.ZodBoolean;
        pinOrder: z.ZodNullable<z.ZodNumber>;
        usageCount: z.ZodNumber;
        lastUsedAt: z.ZodNullable<z.ZodString>;
        source: z.ZodEnum<{
          manual: 'manual';
          import: 'import';
          slip: 'slip';
          share: 'share';
          generation: 'generation';
        }>;
        sourceUrl: z.ZodNullable<z.ZodString>;
        version: z.ZodNumber;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        deletedAt: z.ZodNullable<z.ZodString>;
      },
      z.core.$strip
    >;
    recorded: z.ZodBoolean;
  },
  z.core.$strip
>;
export type PromptDocument = z.infer<typeof promptDocumentSchema>;
export type PromptFolder = z.infer<typeof promptFolderSchema>;
export type PromptTag = z.infer<typeof promptTagSchema>;
export type NewPromptDocument = z.infer<typeof newPromptDocumentSchema>;
export type UpdatePromptDocument = z.infer<typeof updatePromptDocumentSchema>;
export type NewPromptFolder = z.infer<typeof newPromptFolderSchema>;
export type UpdatePromptFolder = z.infer<typeof updatePromptFolderSchema>;
export type NewPromptTag = z.infer<typeof newPromptTagSchema>;
export type UpdatePromptTag = z.infer<typeof updatePromptTagSchema>;
export type PromptListQuery = z.input<typeof promptListQuerySchema>;
export type ParsedPromptListQuery = z.output<typeof promptListQuerySchema>;
export type PromptPage = z.infer<typeof promptPageSchema>;
export type PromptUseInput = z.infer<typeof promptUseInputSchema>;
export type PromptUseResult = z.infer<typeof promptUseResultSchema>;
//# sourceMappingURL=prompt.d.ts.map
