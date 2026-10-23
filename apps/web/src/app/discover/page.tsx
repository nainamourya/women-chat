import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { DiscoverClient } from "./DiscoverClient";

export const metadata: Metadata = { title: "Discover" };

export default async function DiscoverPage() {
  await requireMember();
  return <DiscoverClient />;
}
