import { z } from 'zod';
export declare const accountSummarySchema: z.ZodObject<
  {
    id: z.ZodString;
    username: z.ZodString;
    displayName: z.ZodNullable<z.ZodString>;
    quota: z.ZodNumber;
    quotaUnit: z.ZodString;
    canGenerate: z.ZodBoolean;
  },
  z.core.$strip
>;
export declare const loginRequestSchema: z.ZodObject<
  {
    username: z.ZodString;
    password: z.ZodString;
  },
  z.core.$strip
>;
export declare const registerRequestSchema: z.ZodObject<
  {
    username: z.ZodString;
    password: z.ZodString;
  },
  z.core.$strip
>;
export declare const accountSessionSchema: z.ZodObject<
  {
    account: z.ZodObject<
      {
        id: z.ZodString;
        username: z.ZodString;
        displayName: z.ZodNullable<z.ZodString>;
        quota: z.ZodNumber;
        quotaUnit: z.ZodString;
        canGenerate: z.ZodBoolean;
      },
      z.core.$strip
    >;
    csrfToken: z.ZodString;
  },
  z.core.$strip
>;
export declare const desktopAccountSessionSchema: z.ZodObject<
  {
    account: z.ZodObject<
      {
        id: z.ZodString;
        username: z.ZodString;
        displayName: z.ZodNullable<z.ZodString>;
        quota: z.ZodNumber;
        quotaUnit: z.ZodString;
        canGenerate: z.ZodBoolean;
      },
      z.core.$strip
    >;
    csrfToken: z.ZodString;
    sessionToken: z.ZodString;
  },
  z.core.$strip
>;
export declare const redeemRequestSchema: z.ZodObject<
  {
    code: z.ZodString;
  },
  z.core.$strip
>;
export declare const redeemResultSchema: z.ZodObject<
  {
    account: z.ZodObject<
      {
        id: z.ZodString;
        username: z.ZodString;
        displayName: z.ZodNullable<z.ZodString>;
        quota: z.ZodNumber;
        quotaUnit: z.ZodString;
        canGenerate: z.ZodBoolean;
      },
      z.core.$strip
    >;
    creditedQuota: z.ZodNumber;
  },
  z.core.$strip
>;
export type AccountSummary = z.infer<typeof accountSummarySchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type AccountSession = z.infer<typeof accountSessionSchema>;
export type DesktopAccountSession = z.infer<typeof desktopAccountSessionSchema>;
export type RedeemRequest = z.infer<typeof redeemRequestSchema>;
export type RedeemResult = z.infer<typeof redeemResultSchema>;
//# sourceMappingURL=account.d.ts.map
