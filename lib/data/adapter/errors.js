/**
 * Refusals from storage, in the shape the data layer's runtime recognises.
 *
 * The runtime identifies one of these purely by `name` and by the presence of a
 * structured `cause` - there is no class to extend and no package to import - so
 * this file owns both, and a refusal it does not recognise is re-thrown untouched
 * rather than flattened into a generic one. Losing the distinction is what turns
 * "this name is already taken" into "something went wrong".
 *
 * The numbers are SQLite's own extended result codes. Node reports them as
 * `errcode`, which is stable across versions in a way that the message text is
 * not, so the message is only ever read to pull out *which* field was involved.
 */

const BUSY = 5;
const CONSTRAINT_FOREIGN_KEY = 787;
const CONSTRAINT_NOT_NULL = 1299;
const CONSTRAINT_PRIMARY_KEY = 1555;
const CONSTRAINT_TRIGGER = 1811;
const CONSTRAINT_UNIQUE = 2067;

/** The refusal shape the runtime looks for: a name and a structured cause. */
export class StorageRefusal extends Error {
  constructor(cause) {
    super(typeof cause?.originalMessage === 'string' ? cause.originalMessage : 'storage refused');
    this.name = 'DriverAdapterError';
    this.cause = cause;
  }
}

/** The field names a "... constraint failed: a.b, a.c" message carries. */
function fieldsFrom(message) {
  const tail = typeof message === 'string' ? message.split('constraint failed: ')[1] : undefined;
  if (tail === undefined) return undefined;
  const fields = tail
    .split(', ')
    .map((field) => field.split('.').pop())
    .filter((field) => typeof field === 'string' && field.length > 0);
  return fields.length > 0 ? fields : undefined;
}

function classify(error) {
  const message = typeof error.message === 'string' ? error.message : '';
  switch (error.errcode) {
    case BUSY:
      return { kind: 'SocketTimeout' };
    case CONSTRAINT_UNIQUE:
    case CONSTRAINT_PRIMARY_KEY: {
      const fields = fieldsFrom(message);
      return { kind: 'UniqueConstraintViolation', constraint: fields ? { fields } : undefined };
    }
    case CONSTRAINT_NOT_NULL: {
      const fields = fieldsFrom(message);
      return { kind: 'NullConstraintViolation', constraint: fields ? { fields } : undefined };
    }
    case CONSTRAINT_FOREIGN_KEY:
    case CONSTRAINT_TRIGGER:
      return { kind: 'ForeignKeyConstraintViolation', constraint: { foreignKey: {} } };
    default:
      if (message.startsWith('no such table')) {
        return { kind: 'TableDoesNotExist', table: message.split(': ')[1] };
      }
      if (message.startsWith('no such column')) {
        return { kind: 'ColumnNotFound', column: message.split(': ')[1] };
      }
      if (message.includes('has no column named ')) {
        return { kind: 'ColumnNotFound', column: message.split('has no column named ')[1] };
      }
      return undefined;
  }
}

/**
 * Re-throw a storage refusal as one the runtime understands.
 *
 * Anything unrecognised is re-thrown exactly as it arrived: a refusal wrapped in
 * a kind that does not fit reads as a confident wrong answer, and the one thing
 * worse than an unfamiliar refusal is a familiar-looking one that is not true.
 */
export function rethrowAsStorageRefusal(error) {
  if (typeof error?.code !== 'string' || typeof error?.message !== 'string') throw error;
  const classified = classify(error);
  if (classified === undefined) throw error;
  throw new StorageRefusal({
    originalCode: String(error.errcode ?? error.code),
    originalMessage: error.message,
    ...classified,
  });
}
