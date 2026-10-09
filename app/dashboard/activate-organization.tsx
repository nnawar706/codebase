"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ensureOrganization } from "./organization";

// The backend API can create an org and a membership but can't change which
// org a session has active; only the browser can. Once setActive mints a token
// carrying the org, the refresh re-renders the server with it.
export function ActivateOrganization() {
  const { setActive } = useClerk();
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"working" | "none" | "failed">("working");

  useEffect(() => {
    // Strict mode runs effects twice in dev; one creation request per mount.
    if (started.current) return;
    started.current = true;

    ensureOrganization()
      .then(async (organizationId) => {
        if (!organizationId) {
          setState("none");
          return;
        }
        await setActive({ organization: organizationId });
        router.refresh();
      })
      .catch((error: unknown) => {
        console.error(error);
        setState("failed");
      });
  }, [setActive, router]);

  if (state === "none") {
    return (
      <p className="text-muted">
        No organization. Create or join one from the switcher above.
      </p>
    );
  }
  if (state === "failed") {
    return <p className="text-muted">Couldn&apos;t set up an organization. Reload to retry.</p>;
  }
  return <p className="text-muted">Setting up organization…</p>;
}
