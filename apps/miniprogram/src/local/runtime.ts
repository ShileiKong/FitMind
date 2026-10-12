/** UTF-8 encoding needed by TypeBox on WeChat engines without TextEncoder. */
export class Utf8TextEncoder {
  readonly encoding = 'utf-8';
  encode(input = ''): Uint8Array {
    const text = String(input),
      bytes: number[] = [];
    for (let i = 0; i < text.length; i++) {
      let point = text.charCodeAt(i);
      if (point >= 0xd800 && point <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          point = ((point - 0xd800) << 10) + next - 0xdc00 + 0x10000;
          i++;
        } else point = 0xfffd;
      } else if (point >= 0xdc00 && point <= 0xdfff) point = 0xfffd;
      if (point < 0x80) bytes.push(point);
      else if (point < 0x800)
        bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
      else if (point < 0x10000)
        bytes.push(
          0xe0 | (point >> 12),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
      else
        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
    }
    return new Uint8Array(bytes);
  }
}
export const TextEncoder =
  typeof globalThis.TextEncoder === 'function'
    ? globalThis.TextEncoder
    : Utf8TextEncoder;
