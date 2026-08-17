import { basename, join } from 'path';

export const CLI_PATH_BLOCK_START = '# >>> Musefold CLI PATH >>>';
export const CLI_PATH_BLOCK_END = '# <<< Musefold CLI PATH <<<';

export type PosixShellKind = 'zsh' | 'bash' | 'fish';

export interface PosixShellProfile {
  kind: PosixShellKind;
  path: string;
}

export function resolvePosixShellProfile(
  home: string,
  shellPath: string | undefined,
  exists: (path: string) => boolean,
): PosixShellProfile | null {
  const shell = basename(shellPath || '/bin/zsh');
  if (shell === 'zsh') return { kind: 'zsh', path: join(home, '.zprofile') };
  if (shell === 'fish') {
    return { kind: 'fish', path: join(home, '.config', 'fish', 'conf.d', 'musefold.fish') };
  }
  if (shell === 'bash') {
    const candidates = [join(home, '.bash_profile'), join(home, '.bash_login'), join(home, '.profile')];
    return { kind: 'bash', path: candidates.find(exists) ?? candidates[2] };
  }
  return null;
}

export function managedCliPathBlock(kind: PosixShellKind): string {
  const body = kind === 'fish'
    ? [
        'if not contains -- "$HOME/.local/bin" $PATH',
        '  set -gx PATH "$HOME/.local/bin" $PATH',
        'end',
      ]
    : [
        'case ":$PATH:" in',
        '  *:"$HOME/.local/bin":*) ;;',
        '  *) export PATH="$HOME/.local/bin:$PATH" ;;',
        'esac',
      ];
  return [CLI_PATH_BLOCK_START, ...body, CLI_PATH_BLOCK_END].join('\n');
}

export function upsertManagedCliPathBlock(content: string, block: string): string {
  const start = content.indexOf(CLI_PATH_BLOCK_START);
  const end = content.indexOf(CLI_PATH_BLOCK_END, Math.max(0, start));
  if (start >= 0 && end >= start) {
    return content.slice(0, start) + block + content.slice(end + CLI_PATH_BLOCK_END.length);
  }
  const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}${block}\n`;
}

export function removeManagedCliPathBlock(content: string): string {
  const start = content.indexOf(CLI_PATH_BLOCK_START);
  const end = content.indexOf(CLI_PATH_BLOCK_END, Math.max(0, start));
  if (start < 0 || end < start) return content;
  let after = end + CLI_PATH_BLOCK_END.length;
  if (content.slice(after, after + 2) === '\r\n') after += 2;
  else if (content[after] === '\n') after += 1;
  return content.slice(0, start) + content.slice(after);
}
