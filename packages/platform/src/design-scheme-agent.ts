import type {
  StartDesignSchemeAgentInput,
  AuthorizeDesignSchemeUpdateInput,
  ConfirmDesignSchemeAgentSourceInput,
  CancelDesignSchemeAgentInput,
  DesignSchemeAgentSession,
  DesignSchemeAgentEventPage,
  DesignSchemeAgentHistoryQuery,
  DesignSchemeAgentHistoryPage,
  DesignSchemeTextModelOffer,
} from '@musefold/contracts';

/** Additive asynchronous protocol. Legacy desktop create/modify still resolve completed results. */
export interface DesignSchemeAgentGateway {
  list(query: DesignSchemeAgentHistoryQuery): Promise<DesignSchemeAgentHistoryPage>;
  textModel(): Promise<DesignSchemeTextModelOffer>;
  start(input: StartDesignSchemeAgentInput): Promise<DesignSchemeAgentSession>;
  get(executionId: string): Promise<DesignSchemeAgentSession>;
  events(executionId: string, afterSeq?: number): Promise<DesignSchemeAgentEventPage>;
  confirmSource(input: ConfirmDesignSchemeAgentSourceInput): Promise<DesignSchemeAgentSession>;
  authorizeUpdate(input: AuthorizeDesignSchemeUpdateInput): Promise<DesignSchemeAgentSession>;
  cancel(
    executionId: string,
    operation?: CancelDesignSchemeAgentInput['operation'],
  ): Promise<DesignSchemeAgentSession>;
}
