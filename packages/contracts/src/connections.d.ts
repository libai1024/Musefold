import { z } from 'zod';
export declare const mcpScopeSchema: z.ZodEnum<{
  'account:read': 'account:read';
  'prompts:read': 'prompts:read';
  'skills:read': 'skills:read';
}>;
export declare const mcpConnectionSchema: z.ZodObject<
  {
    id: z.ZodString;
    clientName: z.ZodString;
    scopes: z.ZodArray<
      z.ZodEnum<{
        'account:read': 'account:read';
        'prompts:read': 'prompts:read';
        'skills:read': 'skills:read';
      }>
    >;
    mode: z.ZodEnum<{
      ask_each_time: 'ask_each_time';
      auto_with_limits: 'auto_with_limits';
    }>;
    maxPointsPerGeneration: z.ZodNumber;
    maxPointsPerDay: z.ZodNumber;
    spentPointsToday: z.ZodNumber;
    reservedPointsToday: z.ZodNumber;
    status: z.ZodEnum<{
      active: 'active';
      suspended: 'suspended';
      revoked: 'revoked';
    }>;
    createdAt: z.ZodString;
    lastUsedAt: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const mcpConnectionPageSchema: z.ZodObject<
  {
    items: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          clientName: z.ZodString;
          scopes: z.ZodArray<
            z.ZodEnum<{
              'account:read': 'account:read';
              'prompts:read': 'prompts:read';
              'skills:read': 'skills:read';
            }>
          >;
          mode: z.ZodEnum<{
            ask_each_time: 'ask_each_time';
            auto_with_limits: 'auto_with_limits';
          }>;
          maxPointsPerGeneration: z.ZodNumber;
          maxPointsPerDay: z.ZodNumber;
          spentPointsToday: z.ZodNumber;
          reservedPointsToday: z.ZodNumber;
          status: z.ZodEnum<{
            active: 'active';
            suspended: 'suspended';
            revoked: 'revoked';
          }>;
          createdAt: z.ZodString;
          lastUsedAt: z.ZodNullable<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const updateMcpConnectionSchema: z.ZodObject<
  {
    mode: z.ZodOptional<
      z.ZodEnum<{
        ask_each_time: 'ask_each_time';
        auto_with_limits: 'auto_with_limits';
      }>
    >;
    maxPointsPerGeneration: z.ZodOptional<z.ZodNumber>;
    maxPointsPerDay: z.ZodOptional<z.ZodNumber>;
    scopes: z.ZodOptional<
      z.ZodArray<
        z.ZodEnum<{
          'account:read': 'account:read';
          'prompts:read': 'prompts:read';
          'skills:read': 'skills:read';
        }>
      >
    >;
    suspended: z.ZodOptional<z.ZodBoolean>;
    reauthPassword: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type McpConnection = z.infer<typeof mcpConnectionSchema>;
export type McpConnectionPage = z.infer<typeof mcpConnectionPageSchema>;
export type UpdateMcpConnection = z.infer<typeof updateMcpConnectionSchema>;
export declare const aiProviderSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    type: z.ZodString;
    baseUrl: z.ZodString;
    model: z.ZodString;
    hasKey: z.ZodBoolean;
    keySuffix: z.ZodNullable<z.ZodString>;
    isActive: z.ZodBoolean;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
  },
  z.core.$strip
>;
export declare const createAiProviderSchema: z.ZodObject<
  {
    name: z.ZodString;
    baseUrl: z.ZodString;
    model: z.ZodString;
    apiKey: z.ZodOptional<z.ZodString>;
    activate: z.ZodDefault<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const updateAiProviderSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    baseUrl: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    apiKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  },
  z.core.$strip
>;
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type CreateAiProvider = z.infer<typeof createAiProviderSchema>;
export type UpdateAiProvider = z.infer<typeof updateAiProviderSchema>;
//# sourceMappingURL=connections.d.ts.map
