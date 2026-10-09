// Custom claims added to the Clerk session token in the instance config. The
// organization's name rides on the token so rendering it never needs a call
// back to Clerk.
export {};

declare global {
  interface CustomJwtSessionClaims {
    org_name?: string;
  }
}
