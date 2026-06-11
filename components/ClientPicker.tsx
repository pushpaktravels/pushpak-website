// ============================================================
// ClientPicker — inline account/client typeahead with add-new.
// ============================================================
// The booking-desk picker for "which account is this billed to". Searches the
// one client master (Account.party via /api/clients/search), shows outstanding
// for a little context, and — for desks allowed to — can create a brand-new
// client inline via /api/clients/create without leaving the form.
//
// Bound to a plain string `value` (the party name), so a free-typed name is
// always kept even before it exists in the master. `onMeta` hands back the
// matched/created row (family + outstanding) so a host can prefill or show due.
// ============================================================
import { Combobox, ComboOption } from './Combobox';
import { fmtINR } from '../lib/fmt';

export type ClientHit = { party: string; family: string | null; outstanding: number };

export function ClientPicker({
  value, onChange, onMeta, allowCreate = true,
  placeholder = 'Search client / account by name…', inputStyle, autoFocus,
}: {
  value: string;
  onChange: (party: string) => void;
  onMeta?: (hit: ClientHit | null) => void;
  allowCreate?: boolean;
  placeholder?: string;
  inputStyle?: React.CSSProperties;
  autoFocus?: boolean;
}) {
  async function search(q: string): Promise<ComboOption[]> {
    const r = await fetch(`/api/clients/search?q=${encodeURIComponent(q)}`).then(x => x.json());
    if (!r?.ok) throw new Error(r?.error || 'Search failed');
    return (r.clients as ClientHit[]).map(c => ({
      value: c.party,
      label: c.party,
      sub: c.family || undefined,
      right: c.outstanding > 0 ? `${fmtINR(c.outstanding)} due` : undefined,
      data: c,
    }));
  }

  async function create(text: string): Promise<ComboOption | null> {
    const r = await fetch('/api/clients/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ party: text }),
    }).then(x => x.json());
    if (!r?.ok) throw new Error(r?.error || 'Could not add client');
    const c: ClientHit = {
      party: r.client.party,
      family: r.client.family ?? null,
      outstanding: Number(r.client.outstanding) || 0,
    };
    return { value: c.party, label: c.party, data: c };
  }

  return (
    <Combobox
      value={value}
      onChange={(v, meta) => { onChange(v); onMeta?.((meta as ClientHit) ?? null); }}
      search={search}
      onCreate={allowCreate ? create : undefined}
      createHint={t => `+ Add “${t}” as a new client`}
      placeholder={placeholder}
      inputStyle={inputStyle}
      autoFocus={autoFocus}
      emptyText="No matching client yet."
    />
  );
}
