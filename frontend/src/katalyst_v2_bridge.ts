export type V2ActionType =
  | "NAVIGATE_STAGE"
  | "UPDATE_MAPPING"
  | "ADD_RULE"
  | "TOGGLE_RULE"
  | "RUN_RECONCILIATION"
  | "AUTO_RECONCILE_SUCCESS";

export interface V2Action {
  action: V2ActionType;
  payload: Record<string, any>;
  status?: string;
}

export interface V2WorkspaceContext {
  activeStage: string;
  stageNumber: number;
  stageLabel: string;
  sessionId: string | null;
  gstrFilename?: string;
  prFilename?: string;
  correlations?: any[];
  availableColumnsGstr?: string[];
  availableColumnsPr?: string[];
  selectedRuleIds?: string[];
  rulesSummary?: { id: string; name: string; isActive: boolean }[];
  selectedRecordId?: string | null;
  selectedRecordData?: Record<string, any> | null;
  resultsSummary?: { exact: number; tolerance: number; nearMatch: number; unresolved: number };
}

let currentContext: V2WorkspaceContext | null = null;
const contextListeners = new Set<(ctx: V2WorkspaceContext | null) => void>();
const actionHandlers = new Map<V2ActionType, (payload: any) => void | Promise<void>>();

export const katalystV2Bridge = {
  setContext(ctx: Partial<V2WorkspaceContext> | null) {
    if (ctx === null) {
      currentContext = null;
    } else {
      currentContext = {
        ...(currentContext || {
          activeStage: "setup",
          stageNumber: 1,
          stageLabel: "Stage 1: Setup",
          sessionId: null,
        }),
        ...ctx,
      };
    }
    contextListeners.forEach((fn) => fn(currentContext));
  },

  getContext(): V2WorkspaceContext | null {
    return currentContext;
  },

  subscribe(listener: (ctx: V2WorkspaceContext | null) => void): () => void {
    contextListeners.add(listener);
    listener(currentContext);
    return () => {
      contextListeners.delete(listener);
    };
  },

  registerActionHandler(
    type: V2ActionType,
    handler: (payload: any) => void | Promise<void>
  ): () => void {
    actionHandlers.set(type, handler);
    return () => {
      actionHandlers.delete(type);
    };
  },

  dispatchAction(action: V2Action): boolean {
    const handler = actionHandlers.get(action.action);
    if (handler) {
      try {
        void handler(action.payload);
        return true;
      } catch (err) {
        console.error(`[KatalystV2Bridge] Action handler error for ${action.action}:`, err);
      }
    }
    return false;
  },
};

// Export alias for seamless compatibility
export const copilotV2Bridge = katalystV2Bridge;
