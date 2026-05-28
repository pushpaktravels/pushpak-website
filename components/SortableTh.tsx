// ============================================================
// SortableTh + useSort — small reusable bits used by every list
// table that needs click-to-sort with ▲/▼ direction indicators.
// ============================================================
// Usage in a list page:
//
//   const { key, dir, toggle, sort } = useSort<MyRow, SortKey>(
//     'bill',      // default key
//     'desc',      // default dir
//     {            // mapping from SortKey → value-extractor
//       bill:  r => r.bill,
//       party: r => r.party.toLowerCase(),
//       ...
//     }
//   );
//
//   const sortedRows = sort(rows);
//
//   <SortableTh field="bill" active={key === 'bill'} dir={dir}
//               onSort={toggle} align="right">Outstanding</SortableTh>
//
// Each sort key's default direction is inferred from its initial
// value (number → desc, string → asc) the first time toggle is
// called for it.
// ============================================================
import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export function useSort<Row, K extends string>(
  defaultKey: K,
  defaultDir: SortDir,
  extractors: Record<K, (r: Row) => any>,
) {
  const [key, setKey] = useState<K>(defaultKey);
  const [dir, setDir] = useState<SortDir>(defaultDir);

  function toggle(next: K) {
    if (next === key) {
      setDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setKey(next);
      // Heuristic: pick desc for numeric columns, asc for the rest.
      // We probe the extractor with an empty object to see what it
      // returns — if it's a number type it gets desc, otherwise asc.
      // Callers can always click again to flip.
      const sample = extractors[next];
      const probe = sample({} as Row);
      setDir(typeof probe === 'number' ? 'desc' : 'asc');
    }
  }

  function sort(rows: Row[]): Row[] {
    const ex = extractors[key];
    const out = [...rows];
    out.sort((a, b) => {
      const av = ex(a); const bv = ex(b);
      // Push null/undefined/empty to the end regardless of direction
      const aMissing = av == null || av === '';
      const bMissing = bv == null || bv === '';
      if (aMissing && !bMissing) return 1;
      if (bMissing && !aMissing) return -1;
      if (aMissing && bMissing)  return 0;
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ?  1 : -1;
      return 0;
    });
    return out;
  }

  return { key, dir, toggle, sort };
}

export function SortableTh<K extends string>({
  children, field, active, dir, onSort, align,
}: {
  children: React.ReactNode;
  field: K;
  active: boolean;
  dir: SortDir;
  onSort: (k: K) => void;
  align?: 'left' | 'right';
}) {
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        textAlign: align || 'left',
        padding: '10px 14px', fontSize: 10, letterSpacing: '.16em',
        textTransform: 'uppercase',
        color: active ? 'var(--ink, #0F2855)' : 'var(--ink-soft, #475569)',
        fontWeight: 700, cursor: 'pointer', userSelect: 'none',
      }}
    >
      {children}{' '}
      <span style={{ fontSize: 9, opacity: active ? 1 : 0.3 }}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  );
}
