import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { Providers } from "@/app/providers";
import "./globals.css";

// Signal Desktop uses Inter throughout; `_variables.scss` defines `$inter`.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Signal",
  description:
    "A Signal Messenger clone with real-time messaging, groups, and simulated end-to-end encryption.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The app is a full-height shell; zooming would break the pane layout.
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1b1b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        {/*
          Apply the stored theme before first paint. Without this the app
          renders light and then flips, which is very visible in dark mode.
          It has to be inline and blocking, so it cannot live in a component.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  try {
    var stored = localStorage.getItem('signal-clone.theme') || 'system';
    var dark = stored === 'dark' || (stored === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    }
  } catch (e) {}
})();
            `.trim(),
          }}
        />
      </head>
      <body className="h-full overflow-hidden antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
