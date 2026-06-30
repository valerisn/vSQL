import type { TypeCastField, TypeCastNext } from 'mysql2/promise';

// Optional, opt-in result type-casting compatible with oxmysql / mysql-async,
// for resources that expect those conventions. Off by default (vsql_typecast);
// without it vSQL returns mysql2's native JS types.
//
// Covers the casts stock mysql2 can express through the typeCast field:
//   DATETIME / TIMESTAMP / NEWDATE -> epoch milliseconds (number)
//   DATE                           -> epoch milliseconds at local midnight
//   TINYINT(1)                     -> boolean
//   BIT(1)                         -> boolean
//
// oxmysql additionally returns binary columns as a byte array, but that relies
// on a patch to mysql2 that exposes `field.charset`. vSQL deliberately does not
// patch the driver, so binary columns fall through to mysql2's default (a
// Buffer) - see COMPATIBILITY.md. Everything else falls through to next().
export function castValue(field: TypeCastField, next: TypeCastNext): any {
  switch (field.type) {
    case 'DATETIME':
    case 'DATETIME2':
    case 'TIMESTAMP':
    case 'TIMESTAMP2':
    case 'NEWDATE': {
      const value = field.string();
      return value ? new Date(value).getTime() : null;
    }
    case 'DATE': {
      const value = field.string();
      return value ? new Date(`${value} 00:00:00`).getTime() : null;
    }
    case 'TINY': {
      // Only TINYINT(1) is treated as boolean; wider TINYINT stays numeric.
      if (field.length !== 1) return next();
      const value = field.string();
      return value === '0' ? false : value === '1' ? true : next();
    }
    case 'BIT': {
      const buffer = field.buffer();
      if (!buffer || buffer.length !== 1) return next();
      const value = buffer[0];
      return value === 0 ? false : value === 1 ? true : next();
    }
    default:
      return next();
  }
}
