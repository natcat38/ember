import { handleHandoffRedeem } from "./handoff";
import { handleScheduled, type SchedulerEnv } from "./scheduler";
import { handleSync } from "./sync";
import { handlePasskey } from "./passkeys";
import { handleTgLink, handleTgWebhook } from "./telegram";

// Passkey routes are /api/passkey/{register,login}/{options,verify} (Tech_Scope.md §8, ADR-0005).
const PASSKEY_PREFIX = "/api/passkey/";

// The Telegram webhook lives at /api/tg/<secret>; the secret is the rest of the path (Tech_Scope.md §6).
const TG_HOOK_PREFIX = "/api/tg/";

// One Worker serves the app, the API, and the cron on one origin (ADR-0004). wrangler.jsonc routes only
// /api/* here (`run_worker_first`); everything else is answered by the static-assets layer before this runs, with the
// SPA fallback. The ASSETS fall-through below is a safety net for requests that reach the Worker anyway.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/api/sync") return await handleSync(request, env);
      if (pathname.startsWith(PASSKEY_PREFIX)) return await handlePasskey(request, env, pathname.slice(PASSKEY_PREFIX.length));
      if (pathname === "/api/tg/link") return await handleTgLink(request, env);
      if (pathname === "/api/handoff/redeem") return await handleHandoffRedeem(request, env);
      if (pathname.startsWith(TG_HOOK_PREFIX)) return await handleTgWebhook(request, env, pathname.slice(TG_HOOK_PREFIX.length));
      if (pathname.startsWith("/api/")) return Response.json({ error: "not_found" }, { status: 404 });
      return await env.ASSETS.fetch(request);
    } catch (e) {
      console.error("unhandled", e);
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  },
  // Cron (Tech_Scope.md §4.5, slice 12): wrangler.jsonc `triggers.crons` lists the schedules; scheduler.ts dispatches on which one fired.
  async scheduled(controller, env) {
    await handleScheduled(controller, env satisfies SchedulerEnv);
  },
} satisfies ExportedHandler<Env>;
