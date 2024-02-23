import type { TypeParser } from 'slonik';

const bigintParser = (value: string) => {
  return BigInt(value);
};

export const createInt2TypeParser = (): TypeParser => {
  return {
    name: 'int2',
    parse: bigintParser,
  };
};

export const createInt4TypeParser = (): TypeParser => {
  return {
    name: 'int4',
    parse: bigintParser,
  };
};

export const createInt8TypeParser = (): TypeParser => {
  return {
    name: 'int8',
    parse: bigintParser,
  };
};

export const createFloat4TypeParser = (): TypeParser => {
  return {
    name: 'float4',
    parse: v => v,
  };
};

export const createFloat8TypeParser = (): TypeParser => {
  return {
    name: 'float8',
    parse: v => v,
  };
};
