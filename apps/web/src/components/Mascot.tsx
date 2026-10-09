"use client";

import { motion, useReducedMotion } from "framer-motion";

const INK = "#3a2a52";
const BODY_FILL = "#ede4fb";
const BLUSH = "#ec4899";

export type MascotMood = "wave" | "search" | "celebrate" | "peek";

const sizeClasses = {
  sm: "h-16 w-14",
  md: "h-24 w-20",
  lg: "h-32 w-28",
} as const;

// One original doodle mascot, reused in different "moods" across the app
// instead of scattering one-off illustrations (landing hero, matchmaking
// wait, match-found celebration, empty states).
export function Mascot({
  mood,
  size = "md",
  caption,
  className = "",
}: {
  mood: MascotMood;
  size?: keyof typeof sizeClasses;
  caption?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  const floatAnimation = reduceMotion
    ? undefined
    : mood === "celebrate"
      ? { y: [0, -14, 0] }
      : mood === "search"
        ? { y: [0, -7, 0], rotate: [-3, 3, -3] }
        : { y: [0, -8, 0] };
  const floatTransition = reduceMotion
    ? undefined
    : {
        duration: mood === "celebrate" ? 1.6 : 3,
        repeat: Infinity,
        ease: "easeInOut" as const,
      };

  const waveAnimation = reduceMotion ? undefined : { rotate: [0, -18, -4, -16, 0] };
  const waveTransition = reduceMotion
    ? undefined
    : { duration: 2.2, repeat: Infinity, ease: "easeInOut" as const };

  const bubbleAnimation = reduceMotion
    ? { opacity: 1, y: 0, scale: 1 }
    : { opacity: 1, y: [0, -5, 0], scale: 1 };
  const bubbleTransition = reduceMotion
    ? { duration: 0.4 }
    : {
        y: { duration: 3.2, repeat: Infinity, ease: "easeInOut" as const },
        opacity: { duration: 0.5 },
        scale: { duration: 0.5 },
      };

  const showBothArms = mood === "celebrate";

  return (
    <div className={`relative flex items-center justify-center ${className}`} aria-hidden="true">
      {caption && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={bubbleAnimation}
          transition={bubbleTransition}
          className="absolute -top-2 right-0 z-10 rounded-2xl rounded-br-sm border border-brand/20 bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-md"
        >
          {caption}
        </motion.div>
      )}

      <motion.div animate={floatAnimation} transition={floatTransition} className={sizeClasses[size]}>
        <svg viewBox="0 0 120 160" width="100%" height="100%" fill="none">
          {mood !== "peek" && (
            <>
              <path d="M46 116 L40 148" stroke={INK} strokeWidth="3" strokeLinecap="round" />
              <path d="M34 148 L46 148" stroke={INK} strokeWidth="3" strokeLinecap="round" />
              <path d="M74 116 L80 148" stroke={INK} strokeWidth="3" strokeLinecap="round" />
              <path d="M74 148 L86 148" stroke={INK} strokeWidth="3" strokeLinecap="round" />
            </>
          )}

          {!showBothArms && (
            <path d="M26 80 Q10 92 14 108" stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />
          )}

          <path
            d="M60 18 C88 18 100 42 98 70 C96 100 82 118 60 118 C38 118 24 100 22 70 C20 42 32 18 60 18 Z"
            fill={BODY_FILL}
            stroke={INK}
            strokeWidth="3"
            strokeLinejoin="round"
          />

          <path d="M52 20 Q58 6 66 16" stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />

          <circle cx="40" cy="74" r="4" fill={BLUSH} opacity="0.55" />
          <circle cx="80" cy="74" r="4" fill={BLUSH} opacity="0.55" />

          {mood === "search" ? (
            <>
              <path d="M44 64 Q48 60 52 64" stroke={INK} strokeWidth="2.5" strokeLinecap="round" fill="none" />
              <path d="M68 64 Q72 60 76 64" stroke={INK} strokeWidth="2.5" strokeLinecap="round" fill="none" />
            </>
          ) : (
            <>
              <circle cx="48" cy="64" r="4" fill={INK} />
              <circle cx="72" cy="64" r="4" fill={INK} />
            </>
          )}

          <path
            d={mood === "celebrate" ? "M48 78 Q60 90 72 78" : "M50 80 Q60 88 70 80"}
            stroke={INK}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />

          <motion.g
            style={{ transformOrigin: "94px 78px" }}
            animate={waveAnimation}
            transition={waveTransition}
          >
            <path d="M94 78 Q112 64 108 40" stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />
            <circle cx="108" cy="38" r="6" fill={BODY_FILL} stroke={INK} strokeWidth="3" />
          </motion.g>

          {showBothArms && (
            <motion.g
              style={{ transformOrigin: "26px 78px" }}
              animate={waveAnimation}
              transition={waveTransition}
            >
              <path d="M26 78 Q8 64 12 40" stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />
              <circle cx="12" cy="38" r="6" fill={BODY_FILL} stroke={INK} strokeWidth="3" />
            </motion.g>
          )}
        </svg>
      </motion.div>
    </div>
  );
}
