import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

// Auth.js holds no direct database connection. Credential and Google account
// checks are both delegated to the Express API (the single owner of the
// users table), keeping data access in one place per the project's
// architecture. There is no Auth.js adapter configured, so OAuth sign-in
// never touches its own database — the `signIn` callback below mutates the
// in-memory `user` object with our own internal id/fields, which Auth.js
// then carries straight into the `jwt` callback (safe because, with no
// adapter, it's the exact same object reference throughout the request).
export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const res = await fetch(`${process.env.SERVER_URL}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
          },
          body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
          return null;
        }

        const { user } = (await res.json()) as {
          user: {
            id: string;
            displayName: string;
            verificationStatus: "unverified" | "pending" | "verified" | "rejected";
            role: "user" | "admin";
            ageConfirmed18: boolean;
          };
        };

        return {
          id: user.id,
          name: user.displayName,
          displayName: user.displayName,
          verificationStatus: user.verificationStatus,
          role: user.role,
          ageConfirmed18: user.ageConfirmed18,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") {
        return true;
      }

      if (!user.email) {
        return false;
      }

      try {
        const res = await fetch(`${process.env.SERVER_URL}/api/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-api-secret": process.env.INTERNAL_API_SECRET!,
          },
          body: JSON.stringify({
            email: user.email,
            googleId: account.providerAccountId,
            displayName: user.name ?? "New user",
          }),
        });

        if (!res.ok) {
          return false;
        }

        const { user: internalUser } = (await res.json()) as {
          user: {
            id: string;
            displayName: string;
            verificationStatus: "unverified" | "pending" | "verified" | "rejected";
            role: "user" | "admin";
            ageConfirmed18: boolean;
          };
        };

        // Mutating `user` here is intentional — see file-level comment.
        // Without an Auth.js adapter, this is what carries our internal
        // user record into the `jwt` callback below.
        user.id = internalUser.id;
        user.name = internalUser.displayName;
        user.displayName = internalUser.displayName;
        user.verificationStatus = internalUser.verificationStatus;
        user.role = internalUser.role;
        user.ageConfirmed18 = internalUser.ageConfirmed18;

        return true;
      } catch (err) {
        console.error("google sign-in error:", err);
        return false;
      }
    },
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.verificationStatus = user.verificationStatus;
        token.role = user.role;
        token.ageConfirmed18 = user.ageConfirmed18;
      }
      // Lets the client refresh a stale verificationStatus/ageConfirmed18
      // after the prototype eligibility/age-confirmation flow updates it,
      // without a full re-login.
      if (trigger === "update" && session?.verificationStatus) {
        token.verificationStatus = session.verificationStatus;
      }
      if (trigger === "update" && session?.ageConfirmed18) {
        token.ageConfirmed18 = session.ageConfirmed18;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.verificationStatus = token.verificationStatus;
      session.user.role = token.role;
      session.user.ageConfirmed18 = token.ageConfirmed18;
      return session;
    },
  },
});
