import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { InboxClient } from "./InboxClient";

export const metadata: Metadata = { title: "Chats" };

export default async function MessagesPage() {
  await requireMember();
  return <InboxClient />;
}
