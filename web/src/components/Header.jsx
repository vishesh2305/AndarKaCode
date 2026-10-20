// Logo + one light per laptop, so you can see at a glance whether both are ready.
function Light({ label, ok, detail }) {
  return (
    <span className={`laptop-light ${ok === null ? "light-unknown" : ok ? "light-ok" : "light-off"}`} title={detail}>
      <span className="light-dot" aria-hidden="true" />
      {label}
      <span className="visually-hidden">: {detail}</span>
    </span>
  );
}

export function Header({ health }) {
  const gw = health?.gateway;
  const gpuReady = gw ? gw.reachable && gw.s2cUp && gw.ollamaUp : null;
  const gpuDetail = !gw
    ? "checking…"
    : !gw.reachable
      ? `Not reachable: ${gw.error ?? "is the Gateway running?"}`
      : `Screenshot-to-Code ${gw.s2cUp ? "up" : "down"}, GPU model ${gw.ollamaUp ? "up" : "down"}, ${gw.queueLength ?? 0} job(s) waiting`;

  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mascot" viewBox="-20 -18 40 36" aria-hidden="true">
          <rect x="-17" y="-15" width="34" height="30" rx="12" />
          <circle cx="-6" cy="-2" r="2.6" />
          <circle cx="6" cy="-2" r="2.6" />
          <path d="M-5 6 Q0 9 5 6" />
        </svg>
        <span className="brand-name">AndarKaCode</span>
        <span className="brand-hindi" lang="hi">
          अंदर का कोड
        </span>
      </div>
      <div className="lights">
        <Light label="Mac" ok={health ? health.db : null} detail={health ? (health.db ? "Builder API and database ready" : "Database not connected") : "checking…"} />
        <Light label="Windows GPU" ok={gpuReady} detail={gpuDetail} />
      </div>
    </header>
  );
}
