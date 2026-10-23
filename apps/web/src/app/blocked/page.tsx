import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { BlockedClient } from "./BlockedClient";

export const metadata: Metadata = { title: "Blocked accounts" };

export default async function BlockedPage() {
  await requireMember();
  return <BlockedClient />;
}
