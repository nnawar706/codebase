"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";

// Clerk membership is optional, so a new account starts with no organization.
// This runs only when the session token has no active org, which is the one
// case where the server asks Clerk anything. Everything else reads the token.
//
// Returns the organization the client should make active, or null when there
// is none to activate (the person already had their first org made for them
// and has since left every org).
export async function ensureOrganization(): Promise<string | null> {
  const { userId, orgId } = await auth();
  if (!userId) throw new Error("Not signed in");
  if (orgId) return orgId;

  const clerk = await clerkClient();

  // An invited person already belongs to an org; activate it, don't make one.
  const memberships = await clerk.users.getOrganizationMembershipList({
    userId,
    limit: 1,
  });
  const existing = memberships.data[0];
  if (existing) return existing.organization.id;

  // Once per person, not once per org-less session: someone who leaves every
  // org later shouldn't silently get a fresh one. The marker isn't atomic, so
  // two first-landing requests in the same instant could both create one.
  const user = await clerk.users.getUser(userId);
  if (user.privateMetadata.firstOrganizationCreated === true) return null;

  const organization = await clerk.organizations.createOrganization({
    name: user.firstName ? `${user.firstName}'s Organization` : "My Organization",
    createdBy: userId,
  });
  await clerk.users.updateUserMetadata(userId, {
    privateMetadata: { firstOrganizationCreated: true },
  });
  return organization.id;
}
