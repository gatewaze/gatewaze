export default function EventPortalLoading() {
  return (
    <div className="pub-wrap">
      <style>{`
        .ev-load-skel { background: rgba(var(--ui-text), 0.10); border-radius: 12px; }
        .ev-load-pulse { animation: ev-load-pulse 1.4s ease-in-out infinite; }
        @keyframes ev-load-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        @media (prefers-reduced-motion: reduce) { .ev-load-pulse { animation: none; } }
        .ev-load-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
        .ev-load-hero { display: flex; flex-direction: column; gap: 24px; align-items: flex-start; }
        .ev-load-body { display: grid; grid-template-columns: 1fr; gap: 32px; }
        @media (min-width: 1024px) {
          .ev-load-hero { flex-direction: row; gap: 48px; }
          .ev-load-body { grid-template-columns: 320px minmax(0, 1fr); gap: 48px; }
        }
      `}</style>

      {/* Hero skeleton */}
      <div className="ev-load-hero ev-load-pulse" style={{ paddingTop: 8, paddingBottom: 32 }}>
        {/* Image placeholder */}
        <div style={{ width: '100%', maxWidth: 320, flexShrink: 0 }}>
          <div className="ev-load-skel" style={{ aspectRatio: '1', borderRadius: 16 }} />
        </div>
        {/* Details */}
        <div style={{ flex: 1, minWidth: 0, width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="ev-load-skel" style={{ height: 44, width: '75%' }} />
            <div className="ev-load-skel" style={{ height: 44, width: '50%' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[0, 1].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div className="ev-load-skel" style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 12 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="ev-load-skel" style={{ height: 20, width: 180 }} />
                  <div className="ev-load-skel" style={{ height: 16, width: 120 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body skeleton: sidebar + content */}
      <div className="ev-load-body ev-load-pulse" style={{ paddingBottom: 48 }}>
        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="ev-load-skel" style={{ height: 48 }} />
          <div className="pub-side-card">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="ev-load-skel" style={{ width: 40, height: 40, borderRadius: 11 }} />
                  <div className="ev-load-skel" style={{ height: 14, width: 80 }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ minWidth: 0 }}>
          <div className="pub-side-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="ev-load-skel" style={{ height: 24, width: '33%' }} />
              <div className="ev-load-skel" style={{ height: 16, width: '100%' }} />
              <div className="ev-load-skel" style={{ height: 16, width: '100%' }} />
              <div className="ev-load-skel" style={{ height: 16, width: '83%' }} />
              <div className="ev-load-skel" style={{ height: 16, width: '80%' }} />
            </div>
            <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="ev-load-skel" style={{ height: 24, width: '25%' }} />
              <div className="ev-load-skel" style={{ height: 16, width: '100%' }} />
              <div className="ev-load-skel" style={{ height: 16, width: '75%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
