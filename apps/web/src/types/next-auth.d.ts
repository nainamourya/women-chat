import type { DefaultSession } from "next-auth";

export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected" | "resubmission_required";
export type AccountStatus = "active" | "suspended" | "banned";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      verificationStatus: VerificationStatus;
      role: "user" | "admin";
      ageConfirmed18: boolean;
      accountStatus: AccountStatus;
      suspendedUntil: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    displayName: string;
    verificationStatus: VerificationStatus;
    role: "user" | "admin";
    ageConfirmed18: boolean;
    accountStatus: AccountStatus;
    suspendedUntil: string | null;
  }
}

// next-auth/jwt re-exports JWT from @auth/core/jwt — augmentation must target
// the module where the interface is actually declared to take effect.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    verificationStatus: VerificationStatus;
    role: "user" | "admin";
    ageConfirmed18: boolean;
    accountStatus: AccountStatus;
    suspendedUntil: string | null;
    // When this session was last checked against the server for account deletion.
    accountCheckedAt?: number;
  }
}
