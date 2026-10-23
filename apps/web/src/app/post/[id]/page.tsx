import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { PostDetailClient } from "./PostDetailClient";

export const metadata: Metadata = { title: "Post" };

// Shared links land here. Anonymous visitors are sent to log in; whether the
// signed-in member may actually see the post is decided by the API.
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const { id } = await params;
  return <PostDetailClient postId={id} />;
}
