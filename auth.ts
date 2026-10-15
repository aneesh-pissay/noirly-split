import NextAuth from "next-auth";

const issuer = process.env.AUTH_NOIRLY_ISSUER ?? "http://localhost:3000";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    {
      id: "noirly",
      name: "Noirly",
      type: "oidc",
      issuer,
      clientId: process.env.AUTH_NOIRLY_CLIENT_ID,
      clientSecret: process.env.AUTH_NOIRLY_CLIENT_SECRET,
      checks: ["pkce", "state", "nonce"],
      client: {
        token_endpoint_auth_method: "client_secret_post",
      },
      authorization: {
        params: {
          scope: "openid profile email offline_access",
        },
      },
      profile(profile) {
        return {
          id: profile.sub,
          name: typeof profile.name === "string" ? profile.name : null,
          email: typeof profile.email === "string" ? profile.email : null,
          image: typeof profile.picture === "string" ? profile.picture : null,
        };
      },
    },
  ],
  callbacks: {
    // Only trust an email Identity has verified: anyone can register any
    // address. Identity already refuses unverified accounts; this is the
    // app's own check in case that ever changes.
    signIn({ account, profile }) {
      return account?.provider !== "noirly" || profile?.email_verified === true;
    },
    jwt({ token, user, profile }) {
      if (user?.id) {
        token.identitySub = user.id;
      }
      if (profile && "sub" in profile && typeof profile.sub === "string") {
        token.identitySub = profile.sub;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.identitySub ?? token.sub ?? "");
      }
      return session;
    },
  },
});
