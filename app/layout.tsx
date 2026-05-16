import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solarians Provenance",
  description: "A provenance map from original Solarians SPL tokens to modern Metaplex NFTs."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
