type ClassNameInput = string | false | null | undefined;

export function cn(...inputs: ClassNameInput[]): string {
  return inputs.filter(Boolean).join(' ');
}
