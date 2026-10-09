import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Everything is protected except the sign-in screens and the preview, which
// only renders data checked into the project. The redirect happens here,
// before any page renders, so a signed-out visitor never receives page HTML.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/preview"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
