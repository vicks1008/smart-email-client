import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Email Client",
  description: "Local-first Outlook mailbox dashboard"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
