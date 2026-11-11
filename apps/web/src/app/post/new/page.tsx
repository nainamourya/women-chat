import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { NewPostClient } from "./NewPostClient";

export const metadata: Metadata = { title: "Share a Gii" };

export default async function NewPostPage() {
  await requireMember();
  return <NewPostClient />;
}
