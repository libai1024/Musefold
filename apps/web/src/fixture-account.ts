import {
  accountSummarySchema,
  type AccountSummary,
  type LoginRequest,
  type RedeemResult,
  type RegisterRequest,
} from '@musefold/contracts';
import { WebGatewayError } from './runtime';

const fixtureAccount = accountSummarySchema.parse({
  id: 'fixture-account',
  username: 'musefold',
  displayName: '未像用户',
  quota: 9_300_000,
  quotaUnit: '点',
  canGenerate: true,
});

export class FixtureAccountGateway {
  readonly mode = 'fixture' as const;
  private signedIn = true;
  private account = fixtureAccount;

  async getAccount(): Promise<AccountSummary> {
    await pause(180);
    if (!this.signedIn) throw new WebGatewayError('AUTH_REQUIRED', '请登录 Musefold');
    return this.account;
  }

  async login(_input: LoginRequest): Promise<AccountSummary> {
    await pause(280);
    this.signedIn = true;
    return this.account;
  }

  async register(input: RegisterRequest): Promise<AccountSummary> {
    await pause(280);
    this.account = accountSummarySchema.parse({
      ...fixtureAccount,
      username: input.username,
      displayName: null,
    });
    this.signedIn = true;
    return this.account;
  }

  async redeem(_code: string): Promise<RedeemResult> {
    await pause(160);
    if (!this.signedIn) throw new WebGatewayError('AUTH_REQUIRED', '请登录 Musefold');
    return { account: this.account, creditedQuota: 0 };
  }

  async logout(): Promise<void> {
    await pause(160);
    this.signedIn = false;
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
