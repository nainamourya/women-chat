import type { DefaultSession } from "next-auth";

export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      verificationStatus: VerificationStatus;
      role: "user" | "admin";
      ageConfirmed18: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    displayName: string;
    verificationStatus: VerificationStatus;
    role: "user" | "admin";
    ageConfirmed18: boolean;
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
  }
}
