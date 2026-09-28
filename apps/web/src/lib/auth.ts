import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Auth.js holds no direct database connection. Credential checks are delegated
// to the Express API (the single owner of the users table), keeping data
// access in one place per the project's architecture.
export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
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
          };
        };

        return {
          id: user.id,
          name: user.displayName,
          displayName: user.displayName,
          verificationStatus: user.verificationStatus,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.verificationStatus = user.verificationStatus;
        token.role = user.role;
      }
      // Lets the client refresh a stale verificationStatus after the
      // prototype eligibility flow updates it, without a full re-login.
      if (trigger === "update" && session?.verificationStatus) {
        token.verificationStatus = session.verificationStatus;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.verificationStatus = token.verificationStatus;
      session.user.role = token.role;
      return session;
    },
  },
});
