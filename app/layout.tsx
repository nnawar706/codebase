import { ClerkProvider, OrganizationSwitcher, Show, UserButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeControl, themeInitScript } from "@/layouts/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Codebase",
  description: "Explore any public GitHub repo as a dependency map",
};

// Clerk's components read the same tokens as the app, so they follow the theme
// control without a second theme system.
const clerkAppearance = {
  variables: {
    colorBackground: "var(--background)",
    colorForeground: "var(--foreground)",
    colorMutedForeground: "var(--muted)",
    colorPrimary: "var(--accent)",
    colorPrimaryForeground: "var(--accent-foreground)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--foreground)",
    colorNeutral: "var(--foreground)",
    colorBorder: "var(--border)",
    fontFamily: "var(--font-geist-sans)",
    fontSize: "13px",
    borderRadius: "4px",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by the inline script before paint, so the server and
    // client markup legitimately differ on this one attribute.
    <html
      lang="en"
      data-theme="system"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex h-full flex-col text-xs">
        <ClerkProvider appearance={clerkAppearance}>
          <header className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
            <div className="flex items-center gap-3">
              <span className="font-mono font-medium">Codebase</span>
              {/* Auth state is per-request; Suspense keeps the rest of the shell prerenderable under cacheComponents. */}
              <Suspense fallback={<div className="h-7" />}>
                <Show when="signed-in">
                  <OrganizationSwitcher
                    hidePersonal
                    afterCreateOrganizationUrl="/dashboard"
                    afterSelectOrganizationUrl="/dashboard"
                    afterLeaveOrganizationUrl="/dashboard"
                  />
                </Show>
              </Suspense>
            </div>
            <div className="flex items-center gap-2">
              <ThemeControl />
              <Suspense fallback={<div className="h-7 w-7" />}>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </Suspense>
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </ClerkProvider>
      </body>
    </html>
  );
}
