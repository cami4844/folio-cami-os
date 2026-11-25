export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="Folio, Powered by Cami-OS">
      <svg className="brand-mark" viewBox="0 0 128 128" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
          <path className="brand-paper" d="M31 23h45l21 21v61H31z" />
          <path className="brand-fold" d="M76 23v22h21" />
          <path d="M46 65h36M46 79h28" opacity=".62" />
          <path className="brand-corners" d="M18 42V18h24M86 18h24v24M110 86v24H86M42 110H18V86" />
        </g>
      </svg>
      <div className="brand-copy">
        <strong>Folio</strong>
        {!compact && <span>Powered by Cami-OS</span>}
      </div>
    </div>
  );
}
