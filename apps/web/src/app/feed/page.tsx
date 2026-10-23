import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { FeedClient } from "./FeedClient";

export const metadata: Metadata = { title: "Home" };

export default async function FeedPage() {
  await requireMember();
  return <FeedClient />;
}
