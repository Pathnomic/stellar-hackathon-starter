/**
 * Turning values between what Node's own storage returns and what the data layer
 * expects (`lib/data/adapter/index.js` is the only caller).
 *
 * The numbers in `COLUMN_TYPE` are a wire format, not a choice: the data layer's
 * runtime reads them to decide how to turn a stored value back into a JavaScript
 * one, and it never sees the names. They are copied from the runtime's own list
 * and a value that is not on that list would be silently misread rather than
 * rejected.
 */

/** The runtime's own value-kind numbers. Only the ones storage can produce. */
export const COLUMN_TYPE = Object.freeze({
  Int32: 0,
  Int64: 1,
  Float: 2,
  Double: 3,
  Numeric: 4,
  Boolean: 5,
  Text: 7,
  Date: 8,
  Time: 9,
  DateTime: 10,
  Json: 11,
  Bytes: 13,
  UnknownNumber: 128,
});

/**
 * A declared kind, as the stored shape spells it, to the runtime's number.
 *
 * `null` means "the declaration says nothing useful" - a computed value, or a
 * column declared with no kind at all. Those are worked out from the values
 * themselves further down, because guessing from an empty declaration is how a
 * whole column comes back as the wrong kind.
 */
export function declaredKindToColumnType(declared) {
  if (typeof declared !== 'string') return null;
  switch (declared.toUpperCase()) {
    case '':
      return null;
    case 'DECIMAL':
      return COLUMN_TYPE.Numeric;
    case 'FLOAT':
      return COLUMN_TYPE.Float;
    case 'DOUBLE':
    case 'DOUBLE PRECISION':
    case 'NUMERIC':
    case 'REAL':
      return COLUMN_TYPE.Double;
    case 'TINYINT':
    case 'SMALLINT':
    case 'MEDIUMINT':
    case 'INT':
    case 'INTEGER':
    case 'SERIAL':
    case 'INT2':
      return COLUMN_TYPE.Int32;
    case 'BIGINT':
    case 'UNSIGNED BIG INT':
    case 'INT8':
      return COLUMN_TYPE.Int64;
    case 'DATETIME':
    case 'TIMESTAMP':
      return COLUMN_TYPE.DateTime;
    case 'TIME':
      return COLUMN_TYPE.Time;
    case 'DATE':
      return COLUMN_TYPE.Date;
    case 'TEXT':
    case 'CLOB':
    case 'CHARACTER':
    case 'VARCHAR':
    case 'VARYING CHARACTER':
    case 'NCHAR':
    case 'NATIVE CHARACTER':
    case 'NVARCHAR':
      return COLUMN_TYPE.Text;
    case 'BLOB':
      return COLUMN_TYPE.Bytes;
    case 'BOOLEAN':
      return COLUMN_TYPE.Boolean;
    case 'JSONB':
      return COLUMN_TYPE.Json;
    default:
      return null;
  }
}

function inferFromValue(value) {
  switch (typeof value) {
    case 'string':
      return COLUMN_TYPE.Text;
    case 'bigint':
      return COLUMN_TYPE.Int64;
    case 'boolean':
      return COLUMN_TYPE.Boolean;
    case 'number':
      return COLUMN_TYPE.UnknownNumber;
    default:
      if (value instanceof Uint8Array || value instanceof ArrayBuffer) return COLUMN_TYPE.Bytes;
      throw new TypeError(`a stored value of type ${typeof value} cannot be read`);
  }
}

/**
 * The kind of every returned column.
 *
 * Declarations first; anything they leave open is settled from the first value in
 * that column that is not empty. A column that is empty in every row falls back
 * to a whole number, which is what the reference implementation does and what the
 * runtime copes with - the alternative is refusing a perfectly ordinary read.
 */
export function columnTypesFor(declaredKinds, rows) {
  const types = [];
  const undecided = new Set();
  for (let index = 0; index < declaredKinds.length; index += 1) {
    const mapped = declaredKindToColumnType(declaredKinds[index]);
    types[index] = mapped;
    if (mapped === null) undecided.add(index);
  }
  for (const index of undecided) {
    let settled = false;
    for (const row of rows) {
      const candidate = row[index];
      if (candidate !== null && candidate !== undefined) {
        types[index] = inferFromValue(candidate);
        settled = true;
        break;
      }
    }
    if (!settled) types[index] = COLUMN_TYPE.Int32;
  }
  return types;
}

/** One returned row, with each value put into the form the runtime expects. */
export function readRow(row, columnTypes) {
  const out = [];
  for (let index = 0; index < row.length; index += 1) {
    const value = row[index];
    const type = columnTypes[index];
    if (
      typeof value === 'number' &&
      (type === COLUMN_TYPE.Int32 || type === COLUMN_TYPE.Int64) &&
      !Number.isInteger(value)
    ) {
      out[index] = Math.trunc(value);
      continue;
    }
    if ((typeof value === 'number' || typeof value === 'bigint') && type === COLUMN_TYPE.DateTime) {
      out[index] = new Date(Number(value)).toISOString();
      continue;
    }
    if (typeof value === 'bigint') {
      // Whole numbers come back oversized so nothing is lost on the way out of
      // storage; they are narrowed here only when narrowing is exact, and travel
      // as text when it would not be.
      const asNumber = Number(value);
      out[index] = Number.isSafeInteger(asNumber) ? asNumber : value.toString();
      continue;
    }
    out[index] = value;
  }
  return out;
}

/**
 * One value on its way *into* storage.
 *
 * Node's storage accepts null, numbers, whole numbers, text and bytes and refuses
 * everything else outright - a boolean included - so every other shape is turned
 * into one of those here rather than at the call site.
 */
export function writeArgument(argument, argumentType) {
  if (argument === null || argument === undefined) return null;
  const scalar = argumentType?.scalarType;
  if (typeof argument === 'string' && scalar === 'int') return Number.parseInt(argument, 10);
  if (typeof argument === 'string' && (scalar === 'float' || scalar === 'decimal')) {
    return Number.parseFloat(argument);
  }
  if (typeof argument === 'string' && scalar === 'bigint') return BigInt(argument);
  if (typeof argument === 'boolean') return argument ? 1 : 0;
  let value = argument;
  if (typeof value === 'string' && scalar === 'datetime') value = new Date(value);
  if (value instanceof Date) return value.toISOString().replace('Z', '+00:00');
  if (typeof value === 'string' && scalar === 'bytes') return Buffer.from(value, 'base64');
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}
