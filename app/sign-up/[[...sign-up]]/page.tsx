import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignUpPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      {/* SignUp reads the URL on the client; Suspense lets it stream under cacheComponents. */}
      <Suspense>
        <SignUp />
      </Suspense>
    </div>
  );
}
