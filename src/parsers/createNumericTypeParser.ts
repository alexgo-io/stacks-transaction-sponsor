import { TypeParser } from 'slonik';

const numericParser = (value: string) => {
  return BigInt(value.replace(/\.[0]*$/, ''));
};

export const createNumericTypeParser = (): TypeParser => {
  return {
    name: 'numeric',
    parse: numericParser,
  };
};
