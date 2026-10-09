import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      {/* SignIn reads the URL on the client; Suspense lets it stream under cacheComponents. */}
      <Suspense>
        <SignIn />
      </Suspense>
    </div>
  );
}
