import { crc32, deflateRawSync } from 'node:zlib';
type ZipInput = {
  name: string;
  content?: Uint8Array;
  mode?: number;
  method?: number;
  flags?: number;
  declaredSize?: number;
  crc?: number;
  localName?: string;
  descriptor?: boolean;
  compressed?: Uint8Array;
};

/** Small synthetic ZIP writer; malformed cases deliberately bypass archive libraries. */
export function sourceTestZip(inputs: ZipInput[]) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const input of inputs) {
    const bytes = Buffer.from(input.content ?? '');
    const method = input.method ?? 0;
    const compressed = input.compressed
      ? Buffer.from(input.compressed)
      : method === 8
        ? deflateRawSync(bytes)
        : bytes;
    const name = Buffer.from(input.name);
    const localName = Buffer.from(input.localName ?? input.name);
    const flags = (input.flags ?? 0x800) | (input.descriptor ? 8 : 0);
    const checksum = input.crc ?? crc32(bytes);
    const size = input.declaredSize ?? bytes.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!input.descriptor) {
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(size, 22);
    }
    local.writeUInt16LE(localName.length, 26);
    const descriptor = Buffer.alloc(input.descriptor ? 16 : 0);
    if (input.descriptor) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(size, 12);
    }
    const record = Buffer.concat([local, localName, compressed, descriptor]);
    locals.push(record);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE((3 << 8) | 20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(
      ((input.mode ?? (input.name.endsWith('/') ? 0o040755 : 0o100644)) << 16) >>> 0,
      38,
    );
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += record.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(inputs.length, 8);
  end.writeUInt16LE(inputs.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
