// Typed client for the social API. Every call goes through the same-origin
// proxy at /api/social, which attaches the signed-in member's identity on the
// server — nothing here ever says who is acting.

export type UserCard = { username: string; displayName: string; avatarUrl: string | null };

export type ProfileView = UserCard & {
  bio: string;
  postCount: number;
  followerCount: number;
  followingCount: number;
  isSelf: boolean;
  isFollowing: boolean;
  followsYou: boolean;
  isMutual: boolean;
};

export type OwnProfile = ProfileView & { hasUsername: boolean };

export type UserListItem = UserCard & { isFollowing: boolean; isSelf: boolean };

export type PostView = {
  id: string;
  author: UserCard;
  caption: string;
  imageUrl: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
  isOwner: boolean;
};

export type CommentView = { id: string; author: UserCard; content: string; createdAt: string; canDelete: boolean };

export type MessageView = {
  id: string;
  conversationId: string;
  senderUsername: string;
  fromMe: boolean;
  content: string;
  createdAt: string;
  sharedPost: { id: string; imageUrl: string; caption: string; authorUsername: string } | null;
  sharedPostUnavailable: boolean;
};

export type ConversationView = {
  id: string;
  other: UserCard;
  lastMessage: { content: string; createdAt: string; fromMe: boolean; isPostShare: boolean } | null;
  lastMessageAt: string;
  unreadCount: number;
  canSend: boolean;
};

export type NotificationItem = {
  id: string;
  type: "follow" | "like" | "comment" | "message";
  createdAt: string;
  read: boolean;
  actor: UserCard;
  postId: string | null;
  postImageUrl: string | null;
  commentPreview: string | null;
  conversationId: string | null;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export type ApiErrorCode = "not_eligible" | "username_required" | "not_found" | "blocked" | "not_mutual";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: ApiErrorCode,
  ) {
    super(message);
  }
}

export async function social<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/social${path}`, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("Couldn't reach GiiGirl. Check your connection and try again.", 0);
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const body = (data ?? {}) as { error?: string; code?: ApiErrorCode };
    const fallback = res.status === 429 ? "You're doing that too quickly. Please wait a moment." : "Something went wrong. Please try again.";
    throw new ApiError(typeof body.error === "string" ? body.error : fallback, res.status, body.code);
  }
  return data as T;
}

export const query = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
