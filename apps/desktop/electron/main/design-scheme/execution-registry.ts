export type DesignSchemeExecutionKind = 'create' | 'modify' | 'run';

export type DesignSchemeExecutionTerminalStatus = 'completed' | 'failed' | 'cancelled';

type CancellationControl =
  | {
      abortController: AbortController;
      cancel?: () => void;
    }
  | {
      abortController?: AbortController;
      cancel: () => void;
    };

export type RegisterDesignSchemeExecutionInput = CancellationControl & {
  executionId: string;
  senderId: number;
  kind: DesignSchemeExecutionKind;
  outerSignal?: AbortSignal;
  confirm?: (accepted: boolean) => void;
  activeJobIds?: Iterable<string>;
  cancelJob?: (jobId: string) => void;
  completion?: Promise<unknown>;
};

export interface ActiveDesignSchemeExecution {
  executionId: string;
  senderId: number;
  kind: DesignSchemeExecutionKind;
  activeJobIds: readonly string[];
  registeredAt: number;
}

export interface TerminalDesignSchemeExecution {
  executionId: string;
  senderId: number;
  kind: DesignSchemeExecutionKind;
  terminalStatus: DesignSchemeExecutionTerminalStatus;
  terminatedAt: number;
}

export type RegisterDesignSchemeExecutionOutcome =
  | { status: 'registered'; execution: ActiveDesignSchemeExecution }
  | { status: 'duplicate-active'; executionId: string }
  | { status: 'already-terminal'; executionId: string };

export type GetDesignSchemeExecutionOutcome =
  | { status: 'active'; execution: ActiveDesignSchemeExecution }
  | { status: 'already-terminal'; execution: TerminalDesignSchemeExecution }
  | { status: 'not-found'; executionId: string };

export type ConfirmDesignSchemeExecutionOutcome =
  | { status: 'accepted'; executionId: string }
  | { status: 'cancelled'; executionId: string }
  | { status: 'already-terminal'; executionId: string }
  | { status: 'not-confirmable'; executionId: string }
  | { status: 'not-found'; executionId: string };

export type CancelDesignSchemeExecutionOutcome =
  | { status: 'cancelled'; executionId: string }
  | { status: 'already-terminal'; executionId: string }
  | { status: 'not-found'; executionId: string };

export type MarkDesignSchemeExecutionTerminalOutcome =
  | { status: 'marked-terminal'; executionId: string }
  | { status: 'already-terminal'; executionId: string }
  | { status: 'not-found'; executionId: string };

export type UpdateDesignSchemeExecutionJobsOutcome =
  | { status: 'updated'; execution: ActiveDesignSchemeExecution }
  | { status: 'already-terminal'; executionId: string }
  | { status: 'not-found'; executionId: string };

export interface DesignSchemeExecutionCleanupOutcome {
  cancelledExecutionIds: readonly string[];
}

export interface DesignSchemeExecutionRegistryOptions {
  clock?: () => number;
  tombstoneTtlMs?: number;
  maxTombstones?: number;
}

interface ActiveEntry {
  executionId: string;
  senderId: number;
  kind: DesignSchemeExecutionKind;
  abortController?: AbortController;
  cancel?: () => void;
  confirm?: (accepted: boolean) => void;
  activeJobIds: Set<string>;
  cancelJob?: (jobId: string) => void;
  completion?: Promise<unknown>;
  detachOuterAbort?: () => void;
  registeredAt: number;
}

const DEFAULT_TOMBSTONE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_TOMBSTONES = 256;

/**
 * Tracks renderer-owned design-scheme work without retaining request payloads.
 * Every lookup is scoped to the trusted Electron sender id supplied by the host.
 */
export class DesignSchemeExecutionRegistry {
  private readonly active = new Map<string, ActiveEntry>();
  private readonly tombstones = new Map<string, TerminalDesignSchemeExecution>();
  private readonly completions = new Map<string, Promise<void>>();
  private readonly clock: () => number;
  private readonly tombstoneTtlMs: number;
  private readonly maxTombstones: number;

  constructor(options: DesignSchemeExecutionRegistryOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.tombstoneTtlMs = options.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL_MS;
    this.maxTombstones = options.maxTombstones ?? DEFAULT_MAX_TOMBSTONES;
    if (!Number.isFinite(this.tombstoneTtlMs) || this.tombstoneTtlMs < 0) {
      throw new RangeError('tombstoneTtlMs must be a non-negative finite number');
    }
    if (!Number.isSafeInteger(this.maxTombstones) || this.maxTombstones < 0) {
      throw new RangeError('maxTombstones must be a non-negative safe integer');
    }
  }

  register(input: RegisterDesignSchemeExecutionInput): RegisterDesignSchemeExecutionOutcome {
    this.assertIdentity(input.senderId, input.executionId);
    const now = this.now();
    this.pruneTombstones(now);
    if (this.active.has(input.executionId)) {
      return { status: 'duplicate-active', executionId: input.executionId };
    }
    if (this.tombstones.has(input.executionId)) {
      return { status: 'already-terminal', executionId: input.executionId };
    }

    const entry: ActiveEntry = {
      executionId: input.executionId,
      senderId: input.senderId,
      kind: input.kind,
      abortController: input.abortController,
      cancel: input.cancel,
      confirm: input.confirm,
      activeJobIds: this.jobIdSet(input.activeJobIds ?? []),
      cancelJob: input.cancelJob,
      registeredAt: now,
    };
    this.active.set(entry.executionId, entry);
    if (input.completion) {
      const trackedCompletion = input.completion.then(
        () => {
          this.completions.delete(entry.executionId);
        },
        () => {
          this.completions.delete(entry.executionId);
        },
      );
      this.completions.set(entry.executionId, trackedCompletion);
    }
    if (input.outerSignal) {
      const cancelFromOuter = () => {
        this.cancel(entry.senderId, entry.executionId);
      };
      input.outerSignal.addEventListener('abort', cancelFromOuter, { once: true });
      entry.detachOuterAbort = () => {
        input.outerSignal?.removeEventListener('abort', cancelFromOuter);
      };
      if (input.outerSignal.aborted) cancelFromOuter();
    }
    const current = this.active.get(entry.executionId);
    if (!current) return { status: 'already-terminal', executionId: entry.executionId };
    return { status: 'registered', execution: this.toActiveView(current) };
  }

  get(senderId: number, executionId: string): GetDesignSchemeExecutionOutcome {
    this.assertIdentity(senderId, executionId);
    this.pruneTombstones(this.now());
    const active = this.active.get(executionId);
    if (active?.senderId === senderId) {
      return { status: 'active', execution: this.toActiveView(active) };
    }
    const terminal = this.tombstones.get(executionId);
    if (terminal?.senderId === senderId) {
      return { status: 'already-terminal', execution: { ...terminal } };
    }
    return { status: 'not-found', executionId };
  }

  confirm(
    senderId: number,
    executionId: string,
    decision: boolean | 'install' | 'cancel',
  ): ConfirmDesignSchemeExecutionOutcome {
    this.assertIdentity(senderId, executionId);
    this.pruneTombstones(this.now());
    const entry = this.active.get(executionId);
    if (!entry || entry.senderId !== senderId) {
      return this.ownedTombstone(senderId, executionId)
        ? { status: 'already-terminal', executionId }
        : { status: 'not-found', executionId };
    }
    if (!entry.confirm) return { status: 'not-confirmable', executionId };

    const accepted = decision === true || decision === 'install';
    if (accepted) {
      entry.confirm(true);
      return { status: 'accepted', executionId };
    }

    this.moveToTombstone(entry, 'cancelled', this.now());
    this.invokeBestEffort(() => entry.confirm?.(false));
    this.cancelControls(entry);
    return { status: 'cancelled', executionId };
  }

  cancel(senderId: number, executionId: string): CancelDesignSchemeExecutionOutcome {
    this.assertIdentity(senderId, executionId);
    this.pruneTombstones(this.now());
    const entry = this.active.get(executionId);
    if (!entry || entry.senderId !== senderId) {
      return this.ownedTombstone(senderId, executionId)
        ? { status: 'already-terminal', executionId }
        : { status: 'not-found', executionId };
    }

    this.moveToTombstone(entry, 'cancelled', this.now());
    this.cancelControls(entry);
    return { status: 'cancelled', executionId };
  }

  markTerminal(
    senderId: number,
    executionId: string,
    terminalStatus: Exclude<DesignSchemeExecutionTerminalStatus, 'cancelled'> = 'completed',
  ): MarkDesignSchemeExecutionTerminalOutcome {
    this.assertIdentity(senderId, executionId);
    this.pruneTombstones(this.now());
    const entry = this.active.get(executionId);
    if (!entry || entry.senderId !== senderId) {
      return this.ownedTombstone(senderId, executionId)
        ? { status: 'already-terminal', executionId }
        : { status: 'not-found', executionId };
    }
    this.moveToTombstone(entry, terminalStatus, this.now());
    return { status: 'marked-terminal', executionId };
  }

  setActiveJobIds(
    senderId: number,
    executionId: string,
    jobIds: Iterable<string>,
  ): UpdateDesignSchemeExecutionJobsOutcome {
    this.assertIdentity(senderId, executionId);
    this.pruneTombstones(this.now());
    const entry = this.active.get(executionId);
    if (!entry || entry.senderId !== senderId) {
      return this.ownedTombstone(senderId, executionId)
        ? { status: 'already-terminal', executionId }
        : { status: 'not-found', executionId };
    }
    entry.activeJobIds = this.jobIdSet(jobIds);
    return { status: 'updated', execution: this.toActiveView(entry) };
  }

  cleanupOwner(senderId: number): DesignSchemeExecutionCleanupOutcome {
    this.assertSenderId(senderId);
    const cancelledExecutionIds: string[] = [];
    for (const entry of [...this.active.values()]) {
      if (entry.senderId !== senderId) continue;
      if (this.cancel(senderId, entry.executionId).status === 'cancelled') {
        cancelledExecutionIds.push(entry.executionId);
      }
    }
    for (const [executionId, tombstone] of this.tombstones) {
      if (tombstone.senderId === senderId) this.tombstones.delete(executionId);
    }
    return { cancelledExecutionIds };
  }

  cleanupAll(): DesignSchemeExecutionCleanupOutcome {
    const cancelledExecutionIds: string[] = [];
    for (const entry of [...this.active.values()]) {
      if (this.cancel(entry.senderId, entry.executionId).status === 'cancelled') {
        cancelledExecutionIds.push(entry.executionId);
      }
    }
    this.tombstones.clear();
    return { cancelledExecutionIds };
  }

  /** Waits for execution bodies after cancellation controls have been signalled. */
  async waitForCompletions(): Promise<void> {
    while (this.completions.size > 0) {
      await Promise.all([...this.completions.values()]);
    }
  }

  private moveToTombstone(
    entry: ActiveEntry,
    terminalStatus: DesignSchemeExecutionTerminalStatus,
    terminatedAt: number,
  ): void {
    entry.detachOuterAbort?.();
    entry.detachOuterAbort = undefined;
    this.active.delete(entry.executionId);
    this.tombstones.set(entry.executionId, {
      executionId: entry.executionId,
      senderId: entry.senderId,
      kind: entry.kind,
      terminalStatus,
      terminatedAt,
    });
    this.pruneTombstones(terminatedAt);
  }

  private cancelControls(entry: ActiveEntry): void {
    this.invokeBestEffort(() => entry.abortController?.abort());
    this.invokeBestEffort(() => entry.cancel?.());
    if (entry.cancelJob) {
      for (const jobId of entry.activeJobIds) {
        this.invokeBestEffort(() => entry.cancelJob?.(jobId));
      }
    }
  }

  private ownedTombstone(
    senderId: number,
    executionId: string,
  ): TerminalDesignSchemeExecution | undefined {
    const tombstone = this.tombstones.get(executionId);
    return tombstone?.senderId === senderId ? tombstone : undefined;
  }

  private pruneTombstones(now: number): void {
    for (const [executionId, tombstone] of this.tombstones) {
      if (now - tombstone.terminatedAt >= this.tombstoneTtlMs) {
        this.tombstones.delete(executionId);
      }
    }
    while (this.tombstones.size > this.maxTombstones) {
      const oldestId = this.tombstones.keys().next().value;
      if (oldestId === undefined) break;
      this.tombstones.delete(oldestId);
    }
  }

  private toActiveView(entry: ActiveEntry): ActiveDesignSchemeExecution {
    return {
      executionId: entry.executionId,
      senderId: entry.senderId,
      kind: entry.kind,
      activeJobIds: [...entry.activeJobIds],
      registeredAt: entry.registeredAt,
    };
  }

  private jobIdSet(jobIds: Iterable<string>): Set<string> {
    const normalized = new Set<string>();
    for (const jobId of jobIds) {
      if (typeof jobId !== 'string' || jobId.length === 0) {
        throw new TypeError('active job ids must be non-empty strings');
      }
      normalized.add(jobId);
    }
    return normalized;
  }

  private now(): number {
    const now = this.clock();
    if (!Number.isFinite(now)) throw new RangeError('clock must return a finite number');
    return now;
  }

  private assertIdentity(senderId: number, executionId: string): void {
    this.assertSenderId(senderId);
    if (typeof executionId !== 'string' || executionId.length === 0) {
      throw new TypeError('executionId must be a non-empty string');
    }
  }

  private assertSenderId(senderId: number): void {
    if (!Number.isSafeInteger(senderId) || senderId <= 0) {
      throw new TypeError('senderId must be a positive safe integer');
    }
  }

  private invokeBestEffort(invoke: () => void): void {
    try {
      invoke();
    } catch {
      // Registry cleanup must continue across independent cancellation controls.
    }
  }
}

export const designSchemeExecutionRegistry = new DesignSchemeExecutionRegistry();

export function cleanupDesignSchemeExecutions(): void {
  designSchemeExecutionRegistry.cleanupAll();
}

export async function drainDesignSchemeExecutions(): Promise<void> {
  designSchemeExecutionRegistry.cleanupAll();
  await designSchemeExecutionRegistry.waitForCompletions();
}

export function cleanupDesignSchemeExecutionsForSender(senderId: number): void {
  designSchemeExecutionRegistry.cleanupOwner(senderId);
}

export { DesignSchemeExecutionRegistry as DesktopDesignSchemeExecutionRegistry };
