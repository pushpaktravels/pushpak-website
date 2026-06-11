// ============================================================
// AirlineInput — airline field with a suggest list + free text.
// ============================================================
// A native <datalist> combo: the common carriers from lib/airlines.ts drop
// down as you type, but any name can still be typed (charters / rare carriers
// are never blocked). Used on card bookings and the reservation modal so the
// airline is consistent enough to group in reports without a hard dropdown.
// ============================================================
import { AIRLINES } from '../lib/airlines';

export function AirlineInput({
  value, onChange, inputStyle, placeholder = 'e.g. IndiGo', id = 'pp-airlines',
}: {
  value: string;
  onChange: (v: string) => void;
  inputStyle?: React.CSSProperties;
  placeholder?: string;
  id?: string;
}) {
  return (
    <>
      <input
        list={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={inputStyle}
      />
      <datalist id={id}>
        {AIRLINES.map(a => <option key={a} value={a} />)}
      </datalist>
    </>
  );
}
