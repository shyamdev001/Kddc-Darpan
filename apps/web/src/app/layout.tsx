import type { Metadata } from "next";
import { Anek_Gujarati, Hind_Vadodara } from "next/font/google";
import "./globals.css";

// Display face: variable weight + width, Gujarati and Latin.
const anek = Anek_Gujarati({
  variable: "--font-anek",
  subsets: ["gujarati", "latin"],
  axes: ["wdth"],
});

// Interface face: Gujarati and Latin, so poster names render in the same family as the UI.
const hind = Hind_Vadodara({
  variable: "--font-hind",
  subsets: ["gujarati", "latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "KDCC Darpan",
  description: "Control what plays on every KDCC Bank branch screen",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${anek.variable} ${hind.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
