// 极简参数解析：--flag value / --flag=value / -f 短旗标 / 布尔旗标 / 位置参数。
// 遵循 clig.dev：未知旗标报错（exit 2）而不是静默吞掉。

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export interface FlagSpec {
  /** 长名（不带 --） */
  name: string;
  short?: string;
  /** 是否携带值；false = 布尔旗标 */
  takesValue: boolean;
  /** 可重复（值聚合为逗号串） */
  repeatable?: boolean;
}

export class ArgsError extends Error {}

export function parseArgs(argv: string[], specs: FlagSpec[]): ParsedArgs {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const byShort = new Map(specs.filter((spec) => spec.short).map((spec) => [spec.short!, spec]));
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  const assign = (spec: FlagSpec, value: string | boolean) => {
    if (spec.repeatable && typeof value === 'string' && typeof flags[spec.name] === 'string') {
      flags[spec.name] = `${flags[spec.name]},${value}`;
    } else {
      flags[spec.name] = value;
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      const spec = byName.get(name);
      if (!spec) throw new ArgsError(`未知参数 --${name}`);
      if (!spec.takesValue) {
        if (eq >= 0) throw new ArgsError(`--${name} 不接受值`);
        assign(spec, true);
      } else if (eq >= 0) {
        assign(spec, arg.slice(eq + 1));
      } else {
        const value = argv[index + 1];
        if (value === undefined) throw new ArgsError(`--${name} 缺少值`);
        assign(spec, value);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const spec = byShort.get(arg.slice(1));
      if (!spec) throw new ArgsError(`未知参数 ${arg}`);
      if (!spec.takesValue) {
        assign(spec, true);
      } else {
        const value = argv[index + 1];
        if (value === undefined) throw new ArgsError(`${arg} 缺少值`);
        assign(spec, value);
        index += 1;
      }
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags };
}
