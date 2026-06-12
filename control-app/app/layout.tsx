import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AgriHub Fertigation",
  description: "Automated fertigation control panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <nav className="topbar">
          <span className="brand">🌱 AgriHub Fertigation</span>
          <span className="muted">control panel</span>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
