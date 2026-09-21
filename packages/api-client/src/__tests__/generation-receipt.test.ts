import { describe, expect, it, vi } from 'vitest';
import { createCloudDataGateway } from '../gateway';

const binding = {
  apiIssuer: 'https://api.example.test',
  principalId: 'principal-1',
  payer: { issuer: 'https://provider.example.test', ownerId: 'payer-1' },
  credential: { ref: 'credential-1', version: 2 },
  providerId: 'cloud-default' as const,
  model: 'musefold-image-pro' as const,
  capabilities: { image: true as const, text: false as const },
};
const receipt = {
  id: 'receipt-1',
  principalId: 'principal-1',
  idempotencyKey: 'scheme:execution-1',
  operation: 'scheme_run',
  originalRunId: 'purged-run',
  sourceRunId: null,
  bindingState: 'bound',
  binding,
  status: 'succeeded',
  dispatch: 'claimed',
  costProvenance: 'unknown',
  costPoints: null,
  revision: 4,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:03:00Z',
  terminalAt: '2026-09-08T00:01:00Z',
  purgedAt: '2026-09-08T00:03:00Z',
};
function error(code: string, status: number, details: Record<string, unknown> = {}) {
  return Response.json(
    { error: { code, message: 'Synthetic result', requestId: 'req-1', retryable: false, details } },
    { status },
  );
}

describe('cloud execution receipt transport', () => {
  it('reads a cleaned receipt by escaped key without starting a generation', async () => {
    const fetch = vi.fn(async () => Response.json(receipt));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.example.test', fetch });
    expect(await gateway.generation.getExecutionReceipt?.(receipt.idempotencyKey)).toEqual(receipt);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/generations/receipts/by-key?key=scheme%3Aexecution-1',
      expect.objectContaining({ method: 'GET', credentials: 'include', body: undefined }),
    );
  });

  it('propagates not-found and cleaned outcomes without falling back to a paid POST', async () => {
    const fetch = vi.fn(async () => error('GENERATION_RECEIPT_NOT_FOUND', 404));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.example.test', fetch });
    await expect(gateway.generation.getExecutionReceipt?.('missing-key')).rejects.toMatchObject({
      code: 'GENERATION_RECEIPT_NOT_FOUND',
      status: 404,
    });
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockImplementation(async () =>
      error('GENERATION_RESULT_CLEANED', 410, { receiptId: 'receipt-1' }),
    );
    await expect(gateway.generation.retry('purged-run', 'retry-intent')).rejects.toMatchObject({
      code: 'GENERATION_RESULT_CLEANED',
      details: { receiptId: 'receipt-1' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps bodyless retry compatible and transmits explicit binding unchanged', async () => {
    const fetch = vi.fn(async () => error('GENERATION_BINDING_CHANGED', 409));
    const gateway = createCloudDataGateway({ baseUrl: 'https://api.example.test', fetch });
    await expect(gateway.generation.retry('run-1', 'retry-intent')).rejects.toMatchObject({
      code: 'GENERATION_BINDING_CHANGED',
    });
    expect(fetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ body: undefined, headers: { 'idempotency-key': 'retry-intent' } }),
    );
    await expect(
      gateway.generation.retry('run-1', 'retry-intent', { expectedBinding: binding }),
    ).rejects.toMatchObject({ code: 'GENERATION_BINDING_CHANGED' });
    expect(fetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ expectedBinding: binding }),
        headers: { 'idempotency-key': 'retry-intent', 'content-type': 'application/json' },
      }),
    );
  });
});
