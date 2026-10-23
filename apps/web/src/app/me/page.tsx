import type { Metadata } from "next";
import { requireMember } from "@/lib/social/requireMember";
import { MeClient } from "./MeClient";

export const metadata: Metadata = { title: "My profile" };

export default async function MePage() {
  await requireMember();
  return <MeClient />;
}
