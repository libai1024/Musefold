import { z } from 'zod';
export declare const syncEntityTypeSchema: z.ZodEnum<{
  prompt: 'prompt';
  folder: 'folder';
  tag: 'tag';
}>;
export declare const syncChangeOperationSchema: z.ZodEnum<{
  upsert: 'upsert';
  delete: 'delete';
}>;
export declare const syncMutationOperationSchema: z.ZodEnum<{
  delete: 'delete';
  create: 'create';
  update: 'update';
  restore: 'restore';
}>;
export declare const syncCursorSchema: z.ZodString;
export declare const syncSnapshotSchema: z.ZodUnion<
  readonly [
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
    >,
    z.ZodObject<
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
    >,
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
    >,
  ]
>;
export declare const syncDeviceRegistrationSchema: z.ZodObject<
  {
    deviceId: z.ZodString;
    name: z.ZodString;
    platform: z.ZodEnum<{
      macos: 'macos';
      windows: 'windows';
      linux: 'linux';
    }>;
    clientVersion: z.ZodString;
  },
  z.core.$strip
>;
export declare const syncDeviceSchema: z.ZodObject<
  {
    deviceId: z.ZodString;
    name: z.ZodString;
    platform: z.ZodEnum<{
      macos: 'macos';
      windows: 'windows';
      linux: 'linux';
    }>;
    clientVersion: z.ZodString;
    revoked: z.ZodBoolean;
    lastPullCursor: z.ZodString;
  },
  z.core.$strip
>;
export declare const syncBootstrapQuerySchema: z.ZodObject<
  {
    entity: z.ZodEnum<{
      prompt: 'prompt';
      folder: 'folder';
      tag: 'tag';
    }>;
    after: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<
      z.ZodPipe<
        z.ZodUnion<readonly [z.ZodNumber, z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>]>,
        z.ZodNumber
      >
    >;
  },
  z.core.$strip
>;
export declare const syncBootstrapPageSchema: z.ZodObject<
  {
    snapshotCursor: z.ZodString;
    items: z.ZodArray<
      z.ZodUnion<
        readonly [
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
          >,
          z.ZodObject<
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
          >,
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
          >,
        ]
      >
    >;
    nextPage: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const syncChangeSchema: z.ZodObject<
  {
    seq: z.ZodString;
    entityType: z.ZodEnum<{
      prompt: 'prompt';
      folder: 'folder';
      tag: 'tag';
    }>;
    entityId: z.ZodString;
    operation: z.ZodEnum<{
      upsert: 'upsert';
      delete: 'delete';
    }>;
    version: z.ZodNumber;
    snapshot: z.ZodUnion<
      readonly [
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
        >,
        z.ZodObject<
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
        >,
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
        >,
      ]
    >;
  },
  z.core.$strip
>;
export declare const syncPullQuerySchema: z.ZodObject<
  {
    cursor: z.ZodString;
    limit: z.ZodDefault<
      z.ZodPipe<
        z.ZodUnion<readonly [z.ZodNumber, z.ZodPipe<z.ZodString, z.ZodTransform<number, string>>]>,
        z.ZodNumber
      >
    >;
    deviceId: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export declare const syncPullResultSchema: z.ZodObject<
  {
    changes: z.ZodArray<
      z.ZodObject<
        {
          seq: z.ZodString;
          entityType: z.ZodEnum<{
            prompt: 'prompt';
            folder: 'folder';
            tag: 'tag';
          }>;
          entityId: z.ZodString;
          operation: z.ZodEnum<{
            upsert: 'upsert';
            delete: 'delete';
          }>;
          version: z.ZodNumber;
          snapshot: z.ZodUnion<
            readonly [
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
              >,
              z.ZodObject<
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
              >,
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
              >,
            ]
          >;
        },
        z.core.$strip
      >
    >;
    nextCursor: z.ZodString;
    hasMore: z.ZodBoolean;
  },
  z.core.$strip
>;
export declare const syncMutationSchema: z.ZodObject<
  {
    mutationId: z.ZodString;
    entityType: z.ZodEnum<{
      prompt: 'prompt';
      folder: 'folder';
      tag: 'tag';
    }>;
    entityId: z.ZodString;
    operation: z.ZodEnum<{
      delete: 'delete';
      create: 'create';
      update: 'update';
      restore: 'restore';
    }>;
    baseVersion: z.ZodNullable<z.ZodNumber>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
  },
  z.core.$strip
>;
export declare const syncUsageActionSchema: z.ZodEnum<{
  copy: 'copy';
  apply: 'apply';
  generate: 'generate';
}>;
export declare const syncUsageEventSchema: z.ZodObject<
  {
    eventId: z.ZodString;
    promptId: z.ZodString;
    action: z.ZodEnum<{
      copy: 'copy';
      apply: 'apply';
      generate: 'generate';
    }>;
  },
  z.core.$strip
>;
export declare const syncUsagePushRequestSchema: z.ZodObject<
  {
    deviceId: z.ZodString;
    events: z.ZodArray<
      z.ZodObject<
        {
          eventId: z.ZodString;
          promptId: z.ZodString;
          action: z.ZodEnum<{
            copy: 'copy';
            apply: 'apply';
            generate: 'generate';
          }>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const syncUsageEventResultSchema: z.ZodObject<
  {
    eventId: z.ZodString;
    status: z.ZodEnum<{
      rejected: 'rejected';
      applied: 'applied';
      duplicate: 'duplicate';
    }>;
    errorCode: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const syncUsagePushResultSchema: z.ZodObject<
  {
    results: z.ZodArray<
      z.ZodObject<
        {
          eventId: z.ZodString;
          status: z.ZodEnum<{
            rejected: 'rejected';
            applied: 'applied';
            duplicate: 'duplicate';
          }>;
          errorCode: z.ZodNullable<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const syncPushRequestSchema: z.ZodObject<
  {
    deviceId: z.ZodString;
    mutations: z.ZodArray<
      z.ZodObject<
        {
          mutationId: z.ZodString;
          entityType: z.ZodEnum<{
            prompt: 'prompt';
            folder: 'folder';
            tag: 'tag';
          }>;
          entityId: z.ZodString;
          operation: z.ZodEnum<{
            delete: 'delete';
            create: 'create';
            update: 'update';
            restore: 'restore';
          }>;
          baseVersion: z.ZodNullable<z.ZodNumber>;
          payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const syncMutationResultSchema: z.ZodObject<
  {
    mutationId: z.ZodString;
    status: z.ZodEnum<{
      rejected: 'rejected';
      applied: 'applied';
      duplicate: 'duplicate';
      conflict: 'conflict';
    }>;
    version: z.ZodNullable<z.ZodNumber>;
    snapshot: z.ZodNullable<
      z.ZodUnion<
        readonly [
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
          >,
          z.ZodObject<
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
          >,
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
          >,
        ]
      >
    >;
    errorCode: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const syncPushResultSchema: z.ZodObject<
  {
    results: z.ZodArray<
      z.ZodObject<
        {
          mutationId: z.ZodString;
          status: z.ZodEnum<{
            rejected: 'rejected';
            applied: 'applied';
            duplicate: 'duplicate';
            conflict: 'conflict';
          }>;
          version: z.ZodNullable<z.ZodNumber>;
          snapshot: z.ZodNullable<
            z.ZodUnion<
              readonly [
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
                >,
                z.ZodObject<
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
                >,
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
                >,
              ]
            >
          >;
          errorCode: z.ZodNullable<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const syncStatusSchema: z.ZodObject<
  {
    device: z.ZodObject<
      {
        deviceId: z.ZodString;
        name: z.ZodString;
        platform: z.ZodEnum<{
          macos: 'macos';
          windows: 'windows';
          linux: 'linux';
        }>;
        clientVersion: z.ZodString;
        revoked: z.ZodBoolean;
        lastPullCursor: z.ZodString;
      },
      z.core.$strip
    >;
    serverCursor: z.ZodString;
    pendingConflicts: z.ZodNumber;
  },
  z.core.$strip
>;
export type SyncEntityType = z.infer<typeof syncEntityTypeSchema>;
export type SyncMutationOperation = z.infer<typeof syncMutationOperationSchema>;
export type SyncSnapshot = z.infer<typeof syncSnapshotSchema>;
export type SyncDeviceRegistration = z.infer<typeof syncDeviceRegistrationSchema>;
export type SyncDevice = z.infer<typeof syncDeviceSchema>;
export type SyncBootstrapQuery = z.input<typeof syncBootstrapQuerySchema>;
export type SyncBootstrapPage = z.infer<typeof syncBootstrapPageSchema>;
export type SyncChange = z.infer<typeof syncChangeSchema>;
export type SyncPullQuery = z.input<typeof syncPullQuerySchema>;
export type SyncPullResult = z.infer<typeof syncPullResultSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type SyncUsageAction = z.infer<typeof syncUsageActionSchema>;
export type SyncUsageEvent = z.infer<typeof syncUsageEventSchema>;
export type SyncUsageEventResult = z.infer<typeof syncUsageEventResultSchema>;
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncMutationResult = z.infer<typeof syncMutationResultSchema>;
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;
export type SyncUsagePushRequest = z.infer<typeof syncUsagePushRequestSchema>;
export type SyncUsagePushResult = z.infer<typeof syncUsagePushResultSchema>;
export type SyncStatus = z.infer<typeof syncStatusSchema>;
//# sourceMappingURL=sync.d.ts.map
