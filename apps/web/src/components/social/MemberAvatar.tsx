/* eslint-disable @next/next/no-img-element -- photos are served by an authenticated route, so they can't go through next/image's optimizer */
import { Avatar } from "@/components/ui/Avatar";

const SIZES = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-16 w-16",
  xl: "h-24 w-24 sm:h-28 sm:w-28",
} as const;

type Size = keyof typeof SIZES;

// A member's profile photo, or their initials when they have none.
export function MemberAvatar({
  user,
  size = "md",
}: {
  user: { displayName: string; avatarUrl: string | null };
  size?: Size;
}) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className={`${SIZES[size]} shrink-0 rounded-full border border-border object-cover`} />;
  }
  if (size === "xl") {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex ${SIZES.xl} shrink-0 items-center justify-center rounded-full bg-brand text-3xl font-semibold text-brand-foreground`}
      >
        {user.displayName.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return <Avatar name={user.displayName} size={size} />;
}
