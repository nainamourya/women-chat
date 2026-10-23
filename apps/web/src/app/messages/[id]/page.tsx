import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { ConversationClient } from "./ConversationClient";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  const { id } = await params;
  return <ConversationClient conversationId={id} />;
}
