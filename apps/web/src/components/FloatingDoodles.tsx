"use client";

import { motion, useReducedMotion } from "framer-motion";

const INK = "#3a2a52";

type Doodle = {
  // Tailwind position classes, kept loose/organic rather than a grid.
  className: string;
  size: number;
  color: string;
  duration: number;
  delay: number;
  rotate: number;
  hideOnMobile?: boolean;
  shape: "sparkle" | "heart" | "bubble" | "star" | "ring";
};

const DOODLES: Doodle[] = [
  { className: "left-[8%] top-[18%]", size: 26, color: "#f9a8d4", duration: 4.5, delay: 0, rotate: 10, shape: "sparkle" },
  { className: "right-[10%] top-[14%]", size: 20, color: "#a78bfa", duration: 3.6, delay: 0.4, rotate: -8, shape: "star" },
  { className: "left-[14%] bottom-[22%]", size: 22, color: "#7c3aed", duration: 4, delay: 0.8, rotate: 6, shape: "heart", hideOnMobile: true },
  { className: "right-[6%] bottom-[28%]", size: 30, color: "#ec4899", duration: 5, delay: 0.2, rotate: -6, shape: "bubble" },
  { className: "right-[20%] top-[36%]", size: 16, color: "#38bdf8", duration: 3.2, delay: 1.1, rotate: 12, shape: "ring", hideOnMobile: true },
  { className: "left-[22%] top-[8%]", size: 14, color: "#fbbf24", duration: 3.8, delay: 0.6, rotate: -14, shape: "star", hideOnMobile: true },
];

function DoodleShape({ shape, color, size }: { shape: Doodle["shape"]; color: string; size: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none" } as const;

  switch (shape) {
    case "sparkle":
      return (
        <svg {...common}>
          <path
            d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"
            fill={color}
            stroke={INK}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path
            d="M12 3 L14.5 9.5 L21 10 L16 14.5 L17.5 21 L12 17.5 L6.5 21 L8 14.5 L3 10 L9.5 9.5 Z"
            fill={color}
            stroke={INK}
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "heart":
      return (
        <svg {...common}>
          <path
            d="M12 20 C4 14 2 9.5 5.2 6.8 C7.6 4.8 10.6 5.6 12 8 C13.4 5.6 16.4 4.8 18.8 6.8 C22 9.5 20 14 12 20 Z"
            fill={color}
            stroke={INK}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "bubble":
      return (
        <svg {...common}>
          <path
            d="M3 11 C3 6.6 7 3.5 12 3.5 C17 3.5 21 6.6 21 11 C21 15.4 17 18.5 12 18.5 C10.6 18.5 9.3 18.2 8.1 17.7 L4 20 L5 16.2 C3.7 14.9 3 13 3 11 Z"
            fill={color}
            stroke={INK}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <circle cx="8.5" cy="11" r="1" fill={INK} />
          <circle cx="12" cy="11" r="1" fill={INK} />
          <circle cx="15.5" cy="11" r="1" fill={INK} />
        </svg>
      );
    case "ring":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" fill="none" stroke={color} strokeWidth="3" />
        </svg>
      );
  }
}

// A light scattering of hand-drawn doodle icons (sparkles, hearts, a chat
// bubble) that gently bob in place. Purely decorative filler for otherwise
// empty hero space — reuses the mascot's ink-outline style so it reads as
// one consistent illustration language rather than stock icon clutter.
export function FloatingDoodles() {
  const reduceMotion = useReducedMotion();

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {DOODLES.map((d, i) => (
        <motion.div
          key={i}
          className={`absolute ${d.className} ${d.hideOnMobile ? "hidden sm:block" : ""}`}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={
            reduceMotion
              ? { opacity: 0.85, scale: 1 }
              : {
                  opacity: 0.85,
                  scale: 1,
                  y: [0, -12, 0],
                  rotate: [d.rotate - 6, d.rotate + 6, d.rotate - 6],
                }
          }
          transition={
            reduceMotion
              ? { duration: 0.5 }
              : {
                  opacity: { duration: 0.6, delay: d.delay },
                  scale: { duration: 0.6, delay: d.delay },
                  y: { duration: d.duration, repeat: Infinity, ease: "easeInOut", delay: d.delay },
                  rotate: { duration: d.duration, repeat: Infinity, ease: "easeInOut", delay: d.delay },
                }
          }
        >
          <DoodleShape shape={d.shape} color={d.color} size={d.size} />
        </motion.div>
      ))}
    </div>
  );
}
