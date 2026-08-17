declare module 'diff-match-patch' {
  export type DiffTuple = [-1 | 0 | 1, string];

  export default class DiffMatchPatch {
    diff_main(text1: string, text2: string, checklines?: boolean): DiffTuple[];
    diff_cleanupSemantic(diffs: DiffTuple[]): void;
  }
}
