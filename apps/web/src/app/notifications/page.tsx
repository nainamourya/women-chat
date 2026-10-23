import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { NotificationsClient } from "./NotificationsClient";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireMember();
  return <NotificationsClient />;
}
