// Two overlapping chat bubbles with a heart at the overlap: the product is
// peer-to-peer conversation (matchmaking pairs two women to talk), and the
// heart marks the care/warmth of the connection — not a decorative icon.
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="giigril-bubble-a" x1="8" y1="8" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6b21a8" />
          <stop offset="100%" stopColor="#a21caf" />
        </linearGradient>
        <linearGradient id="giigril-bubble-b" x1="40" y1="40" x2="92" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c026a3" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <path
        d="M36 12a28 28 0 1 0 0 56 28 28 0 0 0 11-2.2
           c1.2 4.5 -1.5 8.7 -5 11.2
           c7-1 13-5.6 16-11.6
           A28 28 0 0 0 36 12z"
        fill="url(#giigril-bubble-a)"
      />
      <path
        d="M64 32a28 28 0 1 1 0 56 28 28 0 0 1 -11-2.2
           c-1.2 4.5 1.5 8.7 5 11.2
           c-7-1 -13-5.6 -16-11.6
           A28 28 0 0 1 64 32z"
        fill="url(#giigril-bubble-b)"
      />
      <path
        d="M50 60c-6-4-10-7.6-10-12.3 0-3 2.4-5.5 5.4-5.5 2 0 3.6 1 4.6 2.6 1-1.6 2.6-2.6 4.6-2.6 3 0 5.4 2.5 5.4 5.5 0 4.7-4 8.3-10 12.3z"
        fill="#fff"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
      <span className="text-2xl font-extrabold tracking-tight sm:text-[1.7rem]">
        <span style={{ color: "#2e1065" }}>Gi</span>
        <span
          style={{
            backgroundImage: "linear-gradient(90deg, #c026a3, #ec4899)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Girl
        </span>
      </span>
    </span>
  );
}
