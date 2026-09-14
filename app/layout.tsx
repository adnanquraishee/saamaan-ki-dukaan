import type { Metadata } from "next";
import { EngineProvider } from "@/components/providers/EngineProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saamaan ki Dukaan — Autonomous Supply Chain Control Tower",
  description: "A working storefront and ten autonomous agents running its supply chain, entirely in the browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <EngineProvider>{children}</EngineProvider>
      </body>
    </html>
  );
}
