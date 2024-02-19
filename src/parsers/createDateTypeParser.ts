import type { TypeParser } from 'slonik';

const timestampWithTimeZoneParser = (value: string | null) => {
  if (value === 'infinity' || value === '-infinity') {
    return null;
  }
  return value === null ? value : new Date(value);
};

const timestampParser = (value: string | null) => {
  if (value === 'infinity' || value === '-infinity') {
    return null;
  }
  return value === null ? value : new Date(`${value} UTC`);
};

export const createTimestampTypeParser = (): TypeParser => {
  return {
    name: 'timestamp',
    parse: timestampParser,
  };
};

export const createTimestampWithTimeZoneTypeParser = (): TypeParser => {
  return {
    name: 'timestamptz',
    parse: timestampWithTimeZoneParser,
  };
};
