import safeJsonStringify from 'safe-json-stringify';

export type ReplacerFn = (key: unknown, value: unknown) => unknown;

export function hexToBuffer(bytesLike: string) {
  return Buffer.from(
    bytesLike.startsWith('0x') ? bytesLike.substring(2) : bytesLike,
    'hex',
  );
}

export function bigintReplacer(replacer?: ReplacerFn | null): ReplacerFn {
  return (key, value) => {
    //if it's a BigInt, return the string value instead
    if (typeof value === 'bigint') return value.toString();
    if (replacer != null) return replacer(key, value);
    return value;
  };
}

export function stringify(
  obj: unknown,
  replacer?: ReplacerFn | null,
  indent?: number,
) {
  return safeJsonStringify(obj as object, bigintReplacer(replacer), indent);
}
