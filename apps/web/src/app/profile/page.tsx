import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ProfileTabs } from "./ProfileTabs";
import type { Interest } from "./ProfileClient";
import type { AccountStatus, VerificationStatus } from "@/types/next-auth";

type ProfileData = {
  displayName: string | null;
  bio: string | null;
  interests: Interest[];
  profileComplete: boolean;
  createdAt: string | null;
  email: string | null;
  role: "user" | "admin";
  verificationStatus: VerificationStatus;
  accountStatus: AccountStatus;
  suspendedUntil: string | null;
  ageConfirmed18: boolean;
};

async function fetchProfile(userId: string): Promise<ProfileData> {
  const res = await fetch(`${process.env.SERVER_URL}/api/profile/${userId}`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });
  const data = await res.json();
  return data.profile;
}

async function fetchInterestCatalog(): Promise<Interest[]> {
  const res = await fetch(`${process.env.SERVER_URL}/api/interests`, {
    headers: { "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
    cache: "no-store",
  });
  const data = await res.json();
  return data.interests;
}

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!session.user.ageConfirmed18) {
    redirect("/confirm-age");
  }

  const [profile, catalog] = await Promise.all([
    fetchProfile(session.user.id),
    fetchInterestCatalog(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
      <h1 className="mb-1 text-2xl font-semibold text-foreground">Your profile</h1>
      <p className="mb-6 text-sm text-muted">
        This is <strong className="text-foreground">private</strong> — only you can see it. It&apos;s not
        a public profile and won&apos;t be shown to other users here. It&apos;s
        used only for matching and chat context later on.
      </p>

      <Suspense fallback={null}>
        <ProfileTabs
          initialDisplayName={profile.displayName ?? ""}
          initialBio={profile.bio ?? ""}
          initialSelectedIds={profile.interests.map((i) => i.id)}
          initialProfileComplete={profile.profileComplete}
          catalog={catalog}
          email={profile.email ?? session.user.email ?? ""}
          verificationStatus={profile.verificationStatus}
          accountStatus={profile.accountStatus}
          suspendedUntil={profile.suspendedUntil}
          ageConfirmed18={profile.ageConfirmed18}
          createdAt={profile.createdAt}
        />
      </Suspense>
    </main>
  );
}
