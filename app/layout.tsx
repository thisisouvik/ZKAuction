import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ZKAuction — Private Reserve Auction on Midnight",
  description:
    "A zero-knowledge private reserve auction dApp on the Midnight Network. Reserve prices stay hidden. Bidder identities are ZK-derived. Full privacy by default.",
  keywords: ["ZK", "auction", "Midnight Network", "zero-knowledge", "privacy", "blockchain", "dApp"],
  openGraph: {
    title: "ZKAuction — Private Reserve Auction",
    description: "Zero-knowledge auctions where reserve prices and bidder identities stay private by cryptographic guarantee.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">
        {children}
      </body>
    </html>
  );
}
