function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type AvatarSize = "sm" | "md" | "lg";

const sizeClasses: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
};

const iconSizeClasses: Record<AvatarSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-7 w-7",
};

// `name` is optional because matched chat/call partners are intentionally
// anonymous by design (profiles are private and never shown to other users).
export function Avatar({ name, size = "md" }: { name?: string; size?: AvatarSize }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-brand-foreground ${sizeClasses[size]}`}
    >
      {name ? (
        initials(name)
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" className={iconSizeClasses[size]}>
          <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-9 2.24-9 5v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-1c0-2.76-4.58-5-9-5z" />
        </svg>
      )}
    </span>
  );
}
