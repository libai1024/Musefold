import { useCallback, useReducer, useRef } from "react";

export interface WorkbenchSessionRecord {
  id: string;
}

export interface WorkbenchSessionControllerState<Session> {
  items: Session[];
  selectedId: string | null;
  openingId: string | null;
  loading: boolean;
  error: string | null;
}

export type WorkbenchSessionControllerAction<Session> =
  | { type: "replace"; items: readonly Session[] }
  | { type: "upsert"; item: Session }
  | { type: "remove"; id: string }
  | { type: "select"; id: string | null }
  | { type: "opening"; id: string | null }
  | { type: "loading"; value: boolean }
  | { type: "error"; value: string | null };

export function workbenchSessionControllerReducer<
  Session extends WorkbenchSessionRecord,
>(
  state: WorkbenchSessionControllerState<Session>,
  action: WorkbenchSessionControllerAction<Session>,
): WorkbenchSessionControllerState<Session> {
  switch (action.type) {
    case "replace":
      return {
        ...state,
        items: [...action.items],
        selectedId:
          state.selectedId &&
          action.items.some((item) => item.id === state.selectedId)
            ? state.selectedId
            : null,
      };
    case "upsert":
      return {
        ...state,
        items: [
          action.item,
          ...state.items.filter((item) => item.id !== action.item.id),
        ],
      };
    case "remove":
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        openingId: state.openingId === action.id ? null : state.openingId,
      };
    case "select":
      return { ...state, selectedId: action.id };
    case "opening":
      return { ...state, openingId: action.id };
    case "loading":
      return { ...state, loading: action.value };
    case "error":
      return { ...state, error: action.value };
  }
}

export interface WorkbenchSessionController<Session> {
  state: WorkbenchSessionControllerState<Session>;
  replace: (items: readonly Session[]) => void;
  upsert: (item: Session) => void;
  remove: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  select: (id: string | null) => void;
  open: (
    id: string,
    load: (id: string) => Promise<Session>,
  ) => Promise<Session | null>;
  refresh: (load: () => Promise<readonly Session[]>) => Promise<Session[]>;
}

/** Shared list lifecycle state; transport and selected-session behavior stay in the host. */
export function useWorkbenchSessionController<
  Session extends WorkbenchSessionRecord,
>(): WorkbenchSessionController<Session> {
  const [state, dispatch] = useReducer(workbenchSessionControllerReducer<Session>, {
    items: [],
    selectedId: null,
    openingId: null,
    loading: false,
    error: null,
  });
  const operationRef = useRef(0);

  const replace = useCallback(
    (items: readonly Session[]) => dispatch({ type: "replace", items }),
    [],
  );
  const upsert = useCallback(
    (item: Session) => dispatch({ type: "upsert", item }),
    [],
  );
  const remove = useCallback(
    (id: string) => dispatch({ type: "remove", id }),
    [],
  );
  const setLoading = useCallback(
    (loading: boolean) => dispatch({ type: "loading", value: loading }),
    [],
  );
  const setError = useCallback(
    (error: string | null) => dispatch({ type: "error", value: error }),
    [],
  );
  const select = useCallback(
    (id: string | null) => dispatch({ type: "select", id }),
    [],
  );
  const open = useCallback(
    async (id: string, load: (sessionId: string) => Promise<Session>) => {
      const operationId = ++operationRef.current;
      setLoading(true);
      setError(null);
      dispatch({ type: "opening", id });
      try {
        const item = await load(id);
        if (operationId !== operationRef.current) return null;
        dispatch({ type: "upsert", item });
        dispatch({ type: "select", id: item.id });
        return item;
      } catch (error) {
        if (operationId !== operationRef.current) return null;
        setError(error instanceof Error ? error.message : "无法打开对话");
        throw error;
      } finally {
        if (operationId === operationRef.current) {
          dispatch({ type: "opening", id: null });
          setLoading(false);
        }
      }
    },
    [setError, setLoading],
  );
  const refresh = useCallback(
    async (load: () => Promise<readonly Session[]>): Promise<Session[]> => {
      const operationId = ++operationRef.current;
      setLoading(true);
      setError(null);
      try {
        const items = [...(await load())];
        if (operationId !== operationRef.current) return [];
        replace(items);
        return items;
      } catch (error) {
        if (operationId !== operationRef.current) return [];
        setError(error instanceof Error ? error.message : "无法读取最近对话");
        throw error;
      } finally {
        if (operationId === operationRef.current) setLoading(false);
      }
    },
    [replace, setError, setLoading],
  );

  return {
    state,
    replace,
    upsert,
    remove,
    setLoading,
    setError,
    select,
    open,
    refresh,
  };
}
