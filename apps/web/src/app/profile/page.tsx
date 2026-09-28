import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ProfileClient, type Interest } from "./ProfileClient";

type ProfileData = {
  bio: string | null;
  interests: Interest[];
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

  const [profile, catalog] = await Promise.all([
    fetchProfile(session.user.id),
    fetchInterestCatalog(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="mb-1 text-2xl font-semibold">Your profile</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        This is <strong>private</strong> — only you can see it. It&apos;s not
        a public profile and won&apos;t be shown to other users here.
      </p>

      <ProfileClient
        initialBio={profile.bio ?? ""}
        initialSelectedIds={profile.interests.map((i) => i.id)}
        catalog={catalog}
      />
    </main>
  );
}
