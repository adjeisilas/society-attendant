import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const brandFont = Manrope({
  subsets: ["latin"],
  variable: "--font-brand",
  display: "swap",
});

const numeralFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-numerals",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s · Staff Attendance",
    default: "Staff Attendance",
  },
  description: "Staff clock-in, clock-out and attendance reporting for the hospital.",
};

export const viewport: Viewport = {
  themeColor: "#0b2427",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // Browser extensions add attributes to <html> before React hydrates. This only
    // silences attribute mismatches on this element, not on anything inside it.
    <html lang="en" className={`${brandFont.variable} ${numeralFont.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
