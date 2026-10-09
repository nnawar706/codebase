import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { ActivateOrganization } from "./activate-organization";

// The organization comes off the session token during server rendering, so it
// is in the HTML the server sends rather than filled in after hydration.
async function CurrentOrganization() {
  const { orgId, sessionClaims } = await auth();

  if (!orgId) return <ActivateOrganization />;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted">organization</dt>
      <dd>{sessionClaims?.org_name ?? <span className="text-muted">name not on token</span>}</dd>
      <dt className="text-muted">id</dt>
      <dd className="font-mono">{orgId}</dd>
    </dl>
  );
}

export default function Home() {
  return (
    <div className="p-3">
      <Suspense>
        <CurrentOrganization />
      </Suspense>
    </div>
  );
}
