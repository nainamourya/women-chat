import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { ProfileClient } from "./ProfileClient";

// Deliberately generic: a profile's name is only for signed-in members, and
// page metadata is visible to anyone who has the link.
export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  await requireMember();
  const { username } = await params;
  return <ProfileClient username={decodeURIComponent(username)} />;
}
