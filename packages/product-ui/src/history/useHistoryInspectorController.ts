import { useCallback, useReducer } from "react";

export type HistoryInspectorMode = "list" | "detail" | "trash";
export type HistoryInspectorOrigin = "list" | "trash";

export interface HistoryInspectorState {
  mode: HistoryInspectorMode;
  origin: HistoryInspectorOrigin;
  selectedId: string | null;
  collapsed: boolean;
}

export type HistoryInspectorAction =
  | { type: "open-detail"; id: string; origin?: HistoryInspectorOrigin }
  | { type: "open-list" }
  | { type: "open-trash" }
  | { type: "select"; id: string | null }
  | { type: "toggle-collapsed" }
  | { type: "set-collapsed"; collapsed: boolean };

export interface HistoryInspectorControllerOptions {
  initialMode?: HistoryInspectorMode;
  initialOrigin?: HistoryInspectorOrigin;
  initialSelectedId?: string | null;
  initialCollapsed?: boolean;
}

export interface HistoryInspectorController extends HistoryInspectorState {
  dispatch: (action: HistoryInspectorAction) => void;
  openDetail: (id: string, origin?: HistoryInspectorOrigin) => void;
  openList: () => void;
  openTrash: () => void;
  select: (id: string | null) => void;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

export function createHistoryInspectorState(
  options: HistoryInspectorControllerOptions = {},
): HistoryInspectorState {
  return {
    mode: options.initialMode ?? "list",
    origin: options.initialOrigin ?? "list",
    selectedId: options.initialSelectedId ?? null,
    collapsed: options.initialCollapsed ?? false,
  };
}

export function historyInspectorReducer(
  state: HistoryInspectorState,
  action: HistoryInspectorAction,
): HistoryInspectorState {
  switch (action.type) {
    case "open-detail":
      return {
        ...state,
        mode: "detail",
        origin: action.origin ?? "list",
        selectedId: action.id,
        collapsed: false,
      };
    case "open-list":
      return { ...state, mode: "list" };
    case "open-trash":
      return { ...state, mode: "trash", selectedId: null };
    case "select":
      return {
        ...state,
        selectedId: action.id,
        collapsed: action.id ? false : state.collapsed,
      };
    case "toggle-collapsed":
      return { ...state, collapsed: !state.collapsed };
    case "set-collapsed":
      return { ...state, collapsed: action.collapsed };
    default:
      return state;
  }
}

export function useHistoryInspectorController(
  options: HistoryInspectorControllerOptions = {},
): HistoryInspectorController {
  const [state, dispatch] = useReducer(
    historyInspectorReducer,
    options,
    createHistoryInspectorState,
  );
  const send = useCallback((action: HistoryInspectorAction) => dispatch(action), []);

  return {
    ...state,
    dispatch: send,
    openDetail: useCallback(
      (id: string, origin: HistoryInspectorOrigin = "list") =>
        send({ type: "open-detail", id, origin }),
      [send],
    ),
    openList: useCallback(() => send({ type: "open-list" }), [send]),
    openTrash: useCallback(() => send({ type: "open-trash" }), [send]),
    select: useCallback((id: string | null) => send({ type: "select", id }), [send]),
    toggleCollapsed: useCallback(() => send({ type: "toggle-collapsed" }), [send]),
    setCollapsed: useCallback(
      (collapsed: boolean) => send({ type: "set-collapsed", collapsed }),
      [send],
    ),
  };
}
