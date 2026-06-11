// ============================================================
// VendorPicker — inline vendor/supplier typeahead with add-new.
// ============================================================
// Searches the Vendor master (/api/vendors) so a booker / form-filler picks an
// existing supplier instead of re-typing it, and — for desks allowed to grow
// the master — can add a new vendor inline. Free-typed names are always kept
// (the field is a plain string), so a one-off supplier never blocks anyone;
// persisting it to the master is the separate, permissioned "add new" action.
// ============================================================
import { Combobox, ComboOption } from './Combobox';

export type VendorHit = {
  id: string; name: string;
  contact?: string | null; gstin?: string | null; notes?: string | null; active?: boolean;
};

export function VendorPicker({
  value, onChange, onMeta, allowCreate = true,
  placeholder = 'Search vendor / supplier…', inputStyle, autoFocus,
}: {
  value: string;
  onChange: (name: string) => void;
  onMeta?: (hit: VendorHit | null) => void;
  allowCreate?: boolean;
  placeholder?: string;
  inputStyle?: React.CSSProperties;
  autoFocus?: boolean;
}) {
  async function search(q: string): Promise<ComboOption[]> {
    const r = await fetch(`/api/vendors?q=${encodeURIComponent(q)}`).then(x => x.json());
    if (!r?.ok) throw new Error(r?.error || 'Search failed');
    return (r.vendors as VendorHit[]).map(v => ({
      value: v.name,
      label: v.name,
      sub: v.gstin ? `GSTIN ${v.gstin}` : (v.contact || undefined),
      data: v,
    }));
  }

  async function create(text: string): Promise<ComboOption | null> {
    const r = await fetch('/api/vendors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: text }),
    }).then(x => x.json());
    if (!r?.ok) throw new Error(r?.error || 'Could not add vendor');
    return { value: r.vendor.name, label: r.vendor.name, data: r.vendor };
  }

  return (
    <Combobox
      value={value}
      onChange={(v, meta) => { onChange(v); onMeta?.((meta as VendorHit) ?? null); }}
      search={search}
      onCreate={allowCreate ? create : undefined}
      createHint={t => `+ Add “${t}” as a new vendor`}
      placeholder={placeholder}
      inputStyle={inputStyle}
      autoFocus={autoFocus}
      emptyText="No matching vendor yet."
    />
  );
}
