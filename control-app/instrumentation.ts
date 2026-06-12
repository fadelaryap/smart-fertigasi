// Next.js startup hook — runs once when the server boots. We start the internal
// scheduler here (Node.js runtime only). The globalThis guard in scheduler.ts
// prevents double-registration across HMR.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    const { startTelegramBot } = await import("./lib/telegram-bot");
    startTelegramBot();
  }
}
