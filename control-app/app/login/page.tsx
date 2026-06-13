import { login } from "./actions";
import { SubmitButton } from "../submit-button";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="panel" style={{ maxWidth: 360, margin: "40px auto" }}>
      <h1>Masuk</h1>
      <p className="muted">AgriHub Fertigation — control panel</p>
      {sp.error && (
        <p style={{ color: "var(--danger)" }}>Username atau password salah.</p>
      )}
      <form action={login}>
        <label htmlFor="username">Username</label>
        <input id="username" name="username" autoFocus autoComplete="username" />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <div style={{ marginTop: 16 }}>
          <SubmitButton pendingText="Masuk…">Masuk</SubmitButton>
        </div>
      </form>
    </div>
  );
}
