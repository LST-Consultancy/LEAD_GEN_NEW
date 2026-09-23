import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  axes: ["opsz"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-face",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Signalroom — revenue operating system",
    template: "%s · Signalroom",
  },
  description:
    "Signalroom turns live buyer signals into revenue: who is likely to buy, why now, what to say, and what your team should do next.",
  applicationName: "Signalroom",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1e21" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Forwarded by middleware. Reading it here makes the layout dynamic, which is
  // required anyway: a per-request nonce cannot be baked into a static page.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body className={`${inter.variable} ${mono.variable} antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:text-brand-fg"
        >
          Skip to main content
        </a>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
