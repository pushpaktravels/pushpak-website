// ============================================================
// ExportButton — one-click XLSX export for any list view.
// ============================================================
// Caller passes rows + a column spec ({ header, get(row) }). We
// build a workbook client-side via the xlsx library (already a
// dep) and trigger a download. Currency / number columns get a
// numeric type so Excel can format / sum them properly.
// ============================================================
import { useState } from 'react';

export type ExportColumn<Row> = {
  header: string;
  get: (r: Row) => string | number | null | undefined;
  numeric?: boolean;
};

export function ExportButton<Row>({
  rows, columns, fileName, label,
}: {
  rows: Row[];
  columns: ExportColumn<Row>[];
  fileName: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      // Lazy-load xlsx so the ~700KB lib only ships when someone
      // actually clicks Export — keeps initial page bundles small.
      const XLSX = await import('xlsx');
      const aoa: any[][] = [columns.map(c => c.header)];
      for (const r of rows) {
        aoa.push(columns.map(c => {
          const v = c.get(r);
          if (v == null) return c.numeric ? 0 : '';
          if (c.numeric) return Number(v);
          return String(v);
        }));
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      (ws as any)['!cols'] = columns.map(c => ({
        wch: Math.max(c.header.length, c.numeric ? 14 : 22),
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, fileName.slice(0, 28));
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `${fileName}-${stamp}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={run} disabled={busy || rows.length === 0} title="Export this list to Excel" style={{
      padding: '8px 14px', borderRadius: 8, cursor: busy || rows.length === 0 ? 'not-allowed' : 'pointer',
      background: 'transparent', color: 'var(--ink)',
      border: '1px solid rgba(15,40,85,0.22)',
      fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase',
      fontFamily: 'inherit', opacity: busy || rows.length === 0 ? 0.5 : 1,
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
      </svg>
      {label || 'Export'}
    </button>
  );
}
