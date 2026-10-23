import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/social/requireMember";
import { FollowListClient } from "./FollowListClient";

export const metadata: Metadata = { title: "Connections" };

// /u/<name>/followers and /u/<name>/following
export default async function FollowListPage({ params }: { params: Promise<{ username: string; kind: string }> }) {
  await requireMember();
  const { username, kind } = await params;
  if (kind !== "followers" && kind !== "following") notFound();
  return <FollowListClient username={decodeURIComponent(username)} kind={kind} />;
}
