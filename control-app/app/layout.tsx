import "./globals.css";
import type { Metadata } from "next";
import Image from "next/image";
import { ThemeToggle } from "./theme-toggle";
import logo from "./logo.webp";

export const metadata: Metadata = {
  title: "AgriHub Fertigation",
  description: "Automated fertigation control panel",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var theme = localStorage.getItem('theme');
                if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body>
        <nav className="topbar">
          <div className="topbar-left">
            <Image
              src={logo}
              alt="AgriHub Logo"
              width={50}
              height={50}
              style={{ objectFit: "contain" }}
              priority
            />
            <div className="topbar-text">
              <span className="brand">AgriHub Fertigation</span>
              <span className="muted topbar-subtitle">control panel</span>
            </div>
          </div>
          <ThemeToggle />
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
