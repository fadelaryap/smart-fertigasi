import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { logout } from "@/app/login/actions";

export const dynamic = "force-dynamic";

const NAV = [
  ["/", "Dashboard"],
  ["/schedules", "Jadwal"],
  ["/devices", "Device"],
  ["/fuzzy", "Fuzzy"],
  ["/settings", "Settings"],
  ["/diagnostics", "Diagnostics"],
  ["/logs", "Logs"],
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Authoritative auth check (verifies the cookie's HMAC signature).
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <nav
        className="panel"
        style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}
      >
        {NAV.map(([href, label]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
        <span className="muted" style={{ marginLeft: "auto" }}>
          👤 {user}
        </span>
        <form action={logout}>
          <button className="secondary" type="submit">
            Logout
          </button>
        </form>
      </nav>
      {children}
    </>
  );
}
