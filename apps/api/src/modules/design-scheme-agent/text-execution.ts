import { ZodError } from 'zod';
import {
  freezeRepositoryMaterials,
  assertRepositoryMaterials,
  repositoryMaterialsInvalid,
} from '../design-scheme-assets/repository.js';
import { applyRepositoryImages } from '@musefold/domain/design-scheme/repository-materials';
import {
  attachCloudAgentMaterials,
  cloudAgentAssets,
  cloudAgentSnapshots,
} from '@musefold/domain/design-scheme/cloud-materials';
import type { DesignSchemeAssetService } from '../design-scheme-assets/service.js';
import { buildCloudUpdatedDocument } from '@musefold/domain/design-scheme/cloud-update';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import {
  designSchemeAgentMaterialsSchema,
  analystReportSchema,
  compilerOutputSchema,
  createDesignSchemeInputSchema,
  type AnalystReport,
  type CompilerOutput,
  type SourceSnapshot,
  type DesignSchemeRolePrompt,
  type designSchemeTextUsageSchema,
} from '@musefold/contracts';
import type { z } from 'zod';
import {
  type MusefoldDatabase,
  designSchemeAgentSessions as sessions,
  designSchemeTextExecutions as executions,
  designSchemeTextCalls as calls,
  designSchemeSourcePreparations as preparations,
  executionDigest,
  ExecutionAuthorityError,
} from '@musefold/db';
import { buildCloudRevisedDocument } from '@musefold/domain/design-scheme/cloud-reviser';
import { buildReviserPrompt } from '@musefold/domain/design-scheme/reviser-prompt';
import { DesignSchemeRevisionAuthority, revisionChanged } from './revision-authority.js';
import { buildAnalystPrompt } from '@musefold/domain/design-scheme/analyst-prompt';
import { buildCompilerPrompt } from '@musefold/domain/design-scheme/compiler-prompt';
import { extractJsonCandidate } from '@musefold/domain/design-scheme/model-json';
import {
  buildCloudCompiledDocument,
  CloudCompilerValidationError,
  validateCloudAnalystReport,
} from '@musefold/domain/design-scheme/cloud-compiler';
import { AppError } from '../../lib/errors.js';
import { DesignSchemeService } from '../design-schemes/service.js';
import type { DesignSchemeSourcePreparationService } from '../design-schemes/source-preparation.js';
import { AgentState, type Row, type Tx, type View } from './state.js';
import type { DesignSchemeTextAuthority } from './text-authority.js';

type Execution = typeof executions.$inferSelect;
type Call = typeof calls.$inferSelect;
type Source = Awaited<ReturnType<DesignSchemeSourcePreparationService['readConfirmed']>>;
const LEASE_MS = 150_000; // Longer than the transport's 120s deadline. Never a resend lease.

/** One durable send per ordinal, with reusable validated results and atomic draft publication. */
export class DesignSchemeTextExecution extends AgentState {
  constructor(
    db: MusefoldDatabase,
    private readonly sources: DesignSchemeSourcePreparationService,
    private readonly authority: DesignSchemeTextAuthority,
    private readonly schemes: DesignSchemeService = new DesignSchemeService(db),
    private readonly assets?: DesignSchemeAssetService,
  ) {
    super(db);
  }

  async process(userId: string, executionId: string) {
    try {
      await this.advance(userId, executionId);
    } catch (error) {
      if (
        error instanceof ExecutionAuthorityError ||
        (error instanceof AppError &&
          error.details.reason === 'AGENT_TEXT_AUTHORIZATION_UNAVAILABLE')
      ) {
        await this.block(userId, executionId, 'AGENT_TEXT_AUTHORIZATION_UNAVAILABLE');
        return;
      }
      if (error instanceof AppError && error.details.reason === 'AGENT_MATERIALS_INVALID') {
        await this.block(userId, executionId, 'AGENT_MATERIALS_INVALID');
        return;
      }
      if (error instanceof AppError && error.details.reason === 'AGENT_BASE_REVISION_CHANGED') {
        await this.block(userId, executionId, 'AGENT_BASE_REVISION_CHANGED');
        return;
      }
      // Queue diagnostics must not contain DB errors with private request JSON or model text.
      throw new Error('Design scheme text execution temporarily unavailable');
    }
  }

  /** Retire stale claims even when a cancellation/expiry already made the parent terminal. */
  async reconcile() {
    const stale = await this.db
      .select()
      .from(calls)
      .where(and(eq(calls.status, 'sent'), lte(calls.leaseUntil, new Date())))
      .orderBy(asc(calls.leaseUntil), asc(calls.userId), asc(calls.executionId), asc(calls.ordinal))
      .limit(100);
    for (const call of stale) {
      const row = await this.db.transaction((tx) => this.row(tx, call.userId, call.executionId));
      if (row) await this.record(row, call.ordinal, { status: 'unknown' });
    }
  }

  private async advance(userId: string, executionId: string) {
    const initial = await this.db.transaction(async (tx) => {
      const current = await this.row(tx, userId, executionId);
      return current ? this.expire(tx, current) : null;
    });
    if (initial?.view.status !== 'compiling' || !initial.request || !initial.view.text) return;
    let row: Row = initial;
    const [execution] = await this.db
      .select()
      .from(executions)
      .where(this.executionIdentity(userId, executionId));
    if (
      !execution ||
      (row.request &&
        'text' in row.request &&
        executionDigest(execution.authorization) !== executionDigest(row.request.text)) ||
      (row.request?.operation === 'check-update' && row.updateContext?.authorizationVersion == null)
    ) {
      await this.block(userId, executionId, 'AGENT_TEXT_AUTHORIZATION_UNAVAILABLE');
      return;
    }
    const previous = await this.db
      .select()
      .from(calls)
      .where(this.callIdentity(userId, executionId))
      .orderBy(asc(calls.ordinal));
    const unresolved = previous.find((call) => call.status !== 'completed');
    if (unresolved) {
      await this.reconcileCall(row, unresolved);
      return;
    }

    if (row.request?.operation === 'modify') {
      await this.modify(row, execution, previous);
      return;
    }
    await this.verifyMaterials(row);
    const sources: Source[] = [];
    try {
      for (const id of this.textSourceIds(row))
        sources.push(await this.sources.readConfirmed(userId, id));
    } catch {
      await this.block(userId, executionId, 'AGENT_TEXT_SOURCE_INVALID');
      return;
    }
    const snapshots = sources.map((source) => source.snapshot);
    const reports: AnalystReport[] = [];
    const brief =
      row.request?.operation === 'check-update'
        ? (row.updateContext?.base.document.compilation.briefExcerpt ??
          row.updateContext?.base.document.summary ??
          '')
        : row.request?.operation === 'create'
          ? row.request.input.brief
          : '';
    const label = (source: Source) =>
      `${source.snapshot.repositoryUrl ?? source.snapshot.uri} @ ${source.snapshot.commitHash ?? source.snapshot.commit}`;
    for (let ordinal = 0; ordinal <= sources.length; ordinal++) {
      const role = ordinal < sources.length ? 'analyst' : 'compiler';
      if (role === 'compiler' && sources.length) {
        row = await this.prepareRepositoryMaterials(row, execution, sources, reports);
        if (row.view.status !== 'compiling') return;
      }
      const completed = previous.find((call) => call.ordinal === ordinal);
      if (completed) {
        if (role === 'analyst')
          reports.push(validateCloudAnalystReport(completed.output, snapshots[ordinal]));
        else
          await this.finish(
            row,
            execution,
            compilerOutputSchema.parse(completed.output),
            snapshots,
          );
        continue;
      }
      const source = sources[ordinal];
      const prompt =
        role === 'analyst'
          ? buildAnalystPrompt({
              brief,
              repositoryLabel: label(source),
              license: null,
              textFiles: source.files
                .filter((file) => file.metadata.kind === 'text')
                .map((file) => ({
                  path: file.metadata.relativePath,
                  text: new TextDecoder('utf-8', { fatal: true }).decode(file.bytes),
                })),
              imagePaths: source.files
                .filter((file) => file.metadata.kind === 'image')
                .map((file) => file.metadata.relativePath),
            })
          : buildCompilerPrompt({
              brief,
              uploadedImageCount: row.materials?.uploads.length ?? 0,
              ...(row.materials?.history
                ? {
                    historyContext: {
                      imageCount: row.materials.history.assets.length,
                      prompts: (row.materials.history.snapshot.historyItems ?? []).flatMap(
                        (item) => (item.prompt === null ? [] : [item.prompt]),
                      ),
                      evidencePaths: (row.materials.history.snapshot.historyItems ?? []).flatMap(
                        (item) => (item.promptPath === null ? [] : [item.promptPath]),
                      ),
                    },
                  }
                : {}),
              ...(sources.length
                ? {
                    repositoryLabel: label(sources[0]),
                    analystReport: reports[0],
                    additionalRepositories: sources.slice(1).map((item, i) => ({
                      repositoryLabel: label(item),
                      analystReport: reports[i + 1],
                    })),
                  }
                : {}),
            });
      if (role === 'compiler' && row.materials?.repositories) {
        prompt.user +=
          '\n\n已固定采用 ' +
          row.materials.repositories.reduce((n, source) => n + source.images.length, 0) +
          ' 张已确认仓库图片，仅保存为参考资产；当前文本模型没有接收其像素，不得声称视觉解析。';
      }
      if (role === 'compiler' && row.request?.operation === 'check-update' && row.updateContext) {
        prompt.user +=
          '\n\n## 需保留的原方案与本次更新要求\n' +
          buildReviserPrompt({
            instruction:
              '仅结合已确认的新来源报告更新原方案，保留未变化来源规则和用户定制；冲突或舍弃在 omitted/warnings 说明。不要把旧来源证据称为本次新分析。',
            document: row.updateContext.base.document,
          }).user;
      }
      await this.verifyMaterials(row);
      let claimed = false;
      let response: Awaited<ReturnType<DesignSchemeTextAuthority['transport']['complete']>>;
      try {
        response = await this.authority.transport.complete(
          prompt,
          execution.authorization.binding.model,
          execution.authorization.maxOutputTokens,
          async () => {
            const credential = await this.claim(row, execution, ordinal, role, prompt, snapshots);
            claimed = credential !== null;
            return credential;
          },
        );
      } catch (error) {
        if (!claimed) throw error;
        await this.record(row, ordinal, { status: 'unknown' });
        return;
      }
      if (!response) return; // Duplicate, cancellation, expiry or source retirement won the claim.
      let output: AnalystReport | CompilerOutput;
      try {
        const raw = JSON.parse(extractJsonCandidate(response.content));
        if (role === 'analyst') output = validateCloudAnalystReport(raw, source.snapshot);
        else {
          output = compilerOutputSchema.parse(raw);
          if (
            output.fidelity === 'faithful' &&
            reports.some((report) => report.unsupported.length > 0)
          )
            throw new Error('Unsupported fidelity');
          if (row.request?.operation === 'check-update' && row.updateContext)
            buildCloudUpdatedDocument(output, row.updateContext, snapshots, {
              revisionId: randomUUID(),
              now: new Date().toISOString(),
              model: execution.authorization.binding.model,
            });
          else
            buildCloudCompiledDocument(
              output,
              [...snapshots, ...cloudAgentSnapshots(row.materials)],
              {
                schemeId: randomUUID(),
                revisionId: randomUUID(),
                now: new Date().toISOString(),
                model: execution.authorization.binding.model,
                brief,
              },
            );
        }
      } catch {
        await this.record(row, ordinal, { status: 'invalid', usage: response.usage });
        return;
      }
      const canContinue = await this.record(row, ordinal, {
        status: 'completed',
        output,
        usage: response.usage,
      });
      if (!canContinue) return;
      if (role === 'analyst') reports.push(analystReportSchema.parse(output));
      else await this.finish(row, execution, compilerOutputSchema.parse(output), snapshots);
    }
  }

  private async prepareRepositoryMaterials(
    row: Row,
    execution: Execution,
    sources: Source[],
    reports: AnalystReport[],
  ): Promise<Row> {
    try {
      if (row.materials?.repositories) {
        assertRepositoryMaterials(
          sources,
          reports,
          designSchemeAgentMaterialsSchema.parse(row.materials),
        );
        return row;
      }
      const existing = cloudAgentAssets(row.materials);
      const retained =
        row.request?.operation === 'check-update' && row.updateContext
          ? row.updateContext.base.document.assetIds.filter(
              (id) =>
                !(row.updateContext?.base.document.repositoryImages ?? []).some(
                  (image) =>
                    image.assetId === id &&
                    row.updateContext?.changes.some(
                      (change) => change.previousSnapshotId === image.snapshotId,
                    ),
                ),
            )
          : [];
      const retainedBytes =
        retained.length && this.assets
          ? await this.assets.documentAssetBytes(
              row.userId,
              row.updateContext!.base.document.schemeId,
              retained,
            )
          : 0;
      const repositories = await freezeRepositoryMaterials(
        sources,
        reports,
        async (input) => {
          if (!this.assets) throw repositoryMaterialsInvalid();
          return this.assets.stage(row.userId, input);
        },
        {
          count: existing.length + retained.length,
          bytes: existing.reduce((sum, asset) => sum + asset.byteSize, 0) + retainedBytes,
        },
      );
      const materials = designSchemeAgentMaterialsSchema.parse({
        ...(row.materials ?? { uploads: [] }),
        repositories,
      });
      const chosen = await this.db.transaction(async (tx) => {
        await this.authority.lock(
          tx,
          row.userId,
          execution.authSessionId,
          execution.authorization.binding,
          execution.authRevision,
        );
        const current = await this.expire(
          tx,
          await this.requireRow(tx, row.userId, row.executionId),
        );
        if (current.view.status !== 'compiling' || current.materials?.repositories) return current;
        if (executionDigest(current.materials) !== executionDigest(row.materials))
          throw repositoryMaterialsInvalid();
        if (
          !(await this.validSources(
            tx,
            current,
            sources.map((source) => source.snapshot),
          ))
        )
          throw repositoryMaterialsInvalid();
        if (this.assets) await this.assets.lockAgentUploads(tx, row.userId, materials);
        const [saved] = await tx
          .update(sessions)
          .set({ materials, updatedAt: new Date() })
          .where(this.identity(row.userId, row.executionId))
          .returning();
        return saved;
      });
      if (chosen.view.status === 'compiling')
        assertRepositoryMaterials(
          sources,
          reports,
          designSchemeAgentMaterialsSchema.parse(chosen.materials),
        );
      return chosen;
    } catch (error) {
      if (
        error instanceof ExecutionAuthorityError ||
        (error instanceof AppError &&
          error.details.reason === 'AGENT_TEXT_AUTHORIZATION_UNAVAILABLE')
      )
        throw error;
      if (
        error instanceof ZodError ||
        error instanceof CloudCompilerValidationError ||
        (error instanceof AppError && error.code === 'VALIDATION_FAILED')
      )
        throw repositoryMaterialsInvalid();
      // Transient storage/DB failures may repeat only free adoption. Completed model calls stay durable.
      throw error;
    }
  }

  private async claim(
    row: Row,
    execution: Execution,
    ordinal: number,
    role: Call['role'],
    prompt: DesignSchemeRolePrompt,
    snapshots: SourceSnapshot[],
  ) {
    return this.db.transaction(async (tx) => {
      const authority = await this.authority.lock(
        tx,
        row.userId,
        execution.authSessionId,
        execution.authorization.binding,
        execution.authRevision,
      );
      const current = await this.expire(tx, await this.requireRow(tx, row.userId, row.executionId));
      if (current.view.status !== 'compiling' || !current.view.text) return null;
      if (current.request && current.request.operation !== 'create') {
        if (!execution.revisionBase) throw revisionChanged();
        await new DesignSchemeRevisionAuthority(this.db).lock(
          tx,
          row.userId,
          current.request.input,
          execution.revisionBase,
        );
      }
      if (
        ordinal >= execution.authorization.maxModelCalls ||
        ordinal !== (current.view.text?.callsCompleted ?? -1)
      )
        return null;
      await this.lockMaterials(tx, row, current);
      if (!(await this.validSources(tx, current, snapshots))) {
        await this.save(tx, current, { status: 'blocked', blocker: 'AGENT_TEXT_SOURCE_INVALID' });
        return null;
      }
      const [inserted] = await tx
        .insert(calls)
        .values({
          userId: row.userId,
          executionId: row.executionId,
          ordinal,
          role,
          prompt,
          requestHash: executionDigest({
            ordinal,
            role,
            prompt,
            authorization: execution.authorization,
          }),
          status: 'sent',
          leaseUntil: new Date(Date.now() + LEASE_MS),
        })
        .onConflictDoNothing()
        .returning({ ordinal: calls.ordinal });
      if (!inserted) return null;
      await this.save(tx, current, {
        text: {
          ...current.view.text,
          callsSent: current.view.text.callsSent + 1,
          cost: 'unknown',
        },
      });
      return authority.encryptedCredential;
    });
  }

  private async record(
    row: Row,
    ordinal: number,
    result:
      | {
          status: 'completed';
          output: AnalystReport | CompilerOutput;
          usage: z.infer<typeof designSchemeTextUsageSchema>;
        }
      | { status: 'invalid' | 'unknown'; usage?: z.infer<typeof designSchemeTextUsageSchema> },
  ) {
    return this.db.transaction(async (tx) => {
      const current = await this.expire(tx, await this.requireRow(tx, row.userId, row.executionId));
      const [call] = await tx
        .select()
        .from(calls)
        .where(and(this.callIdentity(row.userId, row.executionId), eq(calls.ordinal, ordinal)))
        .for('update');
      if (call?.status !== 'sent' || !current.view.text) return false;
      const status = call.leaseUntil.getTime() <= Date.now() ? 'unknown' : result.status;
      await tx
        .update(calls)
        .set({
          status,
          output: status === 'completed' && result.status === 'completed' ? result.output : null,
          usage: result.usage ?? null,
          completedAt: new Date(),
        })
        .where(and(this.callIdentity(row.userId, row.executionId), eq(calls.ordinal, ordinal)));
      // Cancellation/revocation never erases the cost fact. Late output cannot publish a draft.
      const patch: Partial<View> = {
        text: {
          ...current.view.text,
          callsCompleted: current.view.text.callsCompleted + (status === 'completed' ? 1 : 0),
        },
      };
      if (current.view.status === 'compiling' && status !== 'completed') {
        patch.status = status === 'invalid' ? 'failed' : 'blocked';
        patch.blocker =
          status === 'invalid' ? 'AGENT_TEXT_OUTPUT_INVALID' : 'AGENT_TEXT_RESULT_UNKNOWN';
      }
      await this.save(tx, current, patch);
      return current.view.status === 'compiling' && status === 'completed';
    });
  }

  private async reconcileCall(row: Row, call: Call) {
    if (call.status === 'sent') {
      if (call.leaseUntil.getTime() <= Date.now())
        await this.record(row, call.ordinal, { status: 'unknown' });
    } else
      await this.block(
        row.userId,
        row.executionId,
        call.status === 'invalid' ? 'AGENT_TEXT_OUTPUT_INVALID' : 'AGENT_TEXT_RESULT_UNKNOWN',
      );
  }

  private async finish(
    row: Row,
    execution: Execution,
    output: CompilerOutput,
    snapshots: SourceSnapshot[],
  ) {
    if (row.request?.operation === 'check-update')
      return this.finishUpdate(row, execution, output, snapshots);
    await this.verifyMaterials(row);
    await this.db.transaction(async (tx) => {
      await this.authority.lock(
        tx,
        row.userId,
        execution.authSessionId,
        execution.authorization.binding,
        execution.authRevision,
      );
      const current = await this.expire(tx, await this.requireRow(tx, row.userId, row.executionId));
      if (current.view.status !== 'compiling' || row.request?.operation !== 'create') return;
      if (!(await this.validSources(tx, current, snapshots))) {
        await this.save(tx, current, { status: 'blocked', blocker: 'AGENT_TEXT_SOURCE_INVALID' });
        return;
      }
      await this.lockMaterials(tx, row, current);
      const document = attachCloudAgentMaterials(
        buildCloudCompiledDocument(output, [...snapshots, ...cloudAgentSnapshots(row.materials)], {
          schemeId: randomUUID(),
          revisionId: randomUUID(),
          now: new Date().toISOString(),
          model: execution.authorization.binding.model,
          brief: row.request.input.brief,
        }),
        row.materials,
      );
      const input = createDesignSchemeInputSchema.parse({
        executionId: row.executionId,
        brief: row.request.input.brief,
        document,
        sourceUris: row.request.input.sourceUris,
        sourceAssetIds: document.assetIds,
        sourceAssets: cloudAgentAssets(row.materials),
        sourceSnapshots: [...snapshots, ...cloudAgentSnapshots(row.materials)],
        sourceBindings: document.sources,
      });
      const result = await this.schemes.createInTransaction(
        tx,
        row.userId,
        input,
        row.materials ?? undefined,
      );
      await this.save(tx, current, {
        status: 'completed',
        result: { ...result, creationSummary: output.creationSummary },
      });
    });
  }

  private async modify(row: Row, execution: Execution, previous: Call[]) {
    const request = row.request;
    if (request?.operation !== 'modify' || !execution.revisionBase) throw revisionChanged();
    const revisions = new DesignSchemeRevisionAuthority(this.db);
    const base = execution.revisionBase;
    const snapshots = await revisions.snapshots(row.userId, base);
    const validate = (raw: unknown) =>
      buildCloudRevisedDocument(raw, base.document, snapshots, {
        revisionId: randomUUID(),
        now: new Date().toISOString(),
        model: execution.authorization.binding.model,
        instruction: request.input.instruction,
      });
    let output: CompilerOutput;
    if (previous.length) {
      output = compilerOutputSchema.parse(previous[0].output);
      validate(output);
    } else {
      const prompt = buildReviserPrompt({
        instruction: request.input.instruction,
        document: base.document,
      });
      let claimed = false;
      let response: Awaited<ReturnType<DesignSchemeTextAuthority['transport']['complete']>>;
      try {
        response = await this.authority.transport.complete(
          prompt,
          execution.authorization.binding.model,
          execution.authorization.maxOutputTokens,
          async () => {
            const credential = await this.claim(row, execution, 0, 'reviser', prompt, []);
            claimed = credential !== null;
            return credential;
          },
        );
      } catch (error) {
        if (!claimed) throw error;
        await this.record(row, 0, { status: 'unknown' });
        return;
      }
      if (!response) return;
      try {
        output = compilerOutputSchema.parse(JSON.parse(extractJsonCandidate(response.content)));
        validate(output);
      } catch {
        await this.record(row, 0, { status: 'invalid', usage: response.usage });
        return;
      }
      if (!(await this.record(row, 0, { status: 'completed', output, usage: response.usage })))
        return;
    }
    await this.db.transaction(async (tx) => {
      await this.authority.lock(
        tx,
        row.userId,
        execution.authSessionId,
        execution.authorization.binding,
        execution.authRevision,
      );
      const current = await this.expire(tx, await this.requireRow(tx, row.userId, row.executionId));
      if (current.view.status !== 'compiling') return;
      await revisions.lock(tx, row.userId, request.input, base);
      const document = validate(output);
      const result = await this.schemes.updateInTransaction(tx, row.userId, {
        schemeId: request.input.schemeId,
        baseRevisionId: request.input.baseRevisionId,
        expectedVersion: base.expectedVersion,
        document,
      });
      await this.save(tx, current, {
        status: 'completed',
        result: {
          ...result,
          revisionId: document.revisionId,
          trace: document.compilation.trace,
          creationSummary: output.creationSummary,
        },
      });
    });
  }

  private async finishUpdate(
    row: Row,
    execution: Execution,
    output: CompilerOutput,
    snapshots: SourceSnapshot[],
  ) {
    const request = row.request;
    const context = row.updateContext;
    if (request?.operation !== 'check-update' || !context || !execution.revisionBase)
      throw revisionChanged();
    await this.verifyMaterials(row);
    await this.db.transaction(async (tx) => {
      await this.authority.lock(
        tx,
        row.userId,
        execution.authSessionId,
        execution.authorization.binding,
        execution.authRevision,
      );
      const current = await this.expire(tx, await this.requireRow(tx, row.userId, row.executionId));
      if (current.view.status !== 'compiling') return;
      await new DesignSchemeRevisionAuthority(this.db).lock(
        tx,
        row.userId,
        request.input,
        context.base,
      );
      if (!(await this.validSources(tx, current, snapshots))) {
        await this.save(tx, current, { status: 'blocked', blocker: 'AGENT_TEXT_SOURCE_INVALID' });
        return;
      }
      await this.lockMaterials(tx, row, current);
      const document = applyRepositoryImages(
        buildCloudUpdatedDocument(output, context, snapshots, {
          revisionId: randomUUID(),
          now: new Date().toISOString(),
          model: execution.authorization.binding.model,
        }),
        row.materials,
        context.changes.map((change) => change.previousSnapshotId),
      );
      const result = await this.schemes.updateInTransaction(
        tx,
        row.userId,
        {
          schemeId: request.input.schemeId,
          baseRevisionId: request.input.baseRevisionId,
          expectedVersion: request.input.expectedVersion,
          document,
        },
        row.materials ?? undefined,
      );
      await this.save(tx, current, {
        status: 'completed',
        result: {
          ...result,
          revisionId: document.revisionId,
          trace: document.compilation.trace,
          creationSummary: output.creationSummary,
        },
      });
    });
  }
  private textSourceIds(row: Row) {
    return row.request?.operation === 'check-update'
      ? (row.updateContext?.changes.map((change) => change.sourceExecutionId) ?? [])
      : row.sourceExecutionIds;
  }
  private async validSources(tx: Tx, row: Row, snapshots: SourceSnapshot[]) {
    await this.lockSources(tx, row);
    const ids = this.textSourceIds(row);
    if (!ids.length) return snapshots.length === 0;
    const listed = await tx
      .select()
      .from(preparations)
      .where(and(eq(preparations.userId, row.userId), inArray(preparations.executionId, ids)));
    return (
      listed.length === snapshots.length &&
      ids.every((id, i) =>
        listed.some(
          (source) =>
            source.executionId === id &&
            source.status === 'confirmed' &&
            source.expiresAt.getTime() > Date.now() &&
            source.snapshotId === snapshots[i].id &&
            source.contentHash === snapshots[i].contentHash,
        ),
      )
    );
  }
  private async block(userId: string, executionId: string, blocker: View['blocker']) {
    await this.db.transaction(async (tx) => {
      const row = await this.expire(tx, await this.requireRow(tx, userId, executionId));
      if (row.view.status === 'compiling') await this.save(tx, row, { status: 'blocked', blocker });
    });
  }
  private async verifyMaterials(row: Row) {
    if (!row.request || row.request.operation === 'modify') return;
    const ids = row.request.operation === 'create' ? row.request.input.sourceAssetIds : [];
    const history = row.request.operation === 'create' ? row.request.input.historySources : [];
    if (!ids.length && !history.length && !cloudAgentAssets(row.materials).length) return;
    try {
      if (
        !this.assets ||
        !row.materials ||
        executionDigest(history) !==
          executionDigest(
            row.materials.history?.snapshot.historyItems?.map((item) => item.selection) ?? [],
          ) ||
        executionDigest(ids) !==
          executionDigest(row.materials.uploads.map((item) => item.sourceAssetId))
      )
        throw new Error('Unavailable');
      await this.assets.verifyAgentUploads(row.userId, row.materials);
    } catch {
      throw materialsInvalid();
    }
  }
  private async lockMaterials(tx: Tx, expected: Row, current: Row) {
    if (!current.request || current.request.operation === 'modify') return;
    if (
      !cloudAgentAssets(current.materials).length &&
      !current.materials?.repositories &&
      (current.request.operation !== 'create' ||
        (!current.request.input.sourceAssetIds.length &&
          !current.request.input.historySources.length))
    )
      return;
    try {
      if (
        !current.materials ||
        executionDigest(current.materials) !== executionDigest(expected.materials)
      )
        throw new Error('Unavailable');
      if (cloudAgentAssets(current.materials).length) {
        if (!this.assets) throw new Error('Unavailable');
        await this.assets.lockAgentUploads(tx, current.userId, current.materials);
      }
    } catch {
      throw materialsInvalid();
    }
  }
  private executionIdentity(userId: string, executionId: string) {
    return and(eq(executions.userId, userId), eq(executions.executionId, executionId));
  }
  private callIdentity(userId: string, executionId: string) {
    return and(eq(calls.userId, userId), eq(calls.executionId, executionId));
  }
}

function materialsInvalid() {
  return new AppError('VALIDATION_FAILED', '方案素材已变化或不可用，请重新选择后创建', 409, false, {
    reason: 'AGENT_MATERIALS_INVALID',
  });
}
