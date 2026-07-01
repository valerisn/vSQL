import type { TypeCastField, TypeCastNext } from 'mysql2/promise';

// Opt-in casting for resources that expect oxmysql / mysql-async conventions
// (vsql_typecast). Off by default, when vSQL returns mysql2's native types.
//   DATETIME / TIMESTAMP / NEWDATE -> epoch milliseconds
//   DATE                           -> epoch milliseconds at local midnight
//   TINYINT(1) / BIT(1)            -> boolean
// oxmysql also returns binary columns as a byte array, but that needs a mysql2
// patch we don't apply, so binary falls through to a Buffer - see COMPATIBILITY.md.
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
