import { handleHandoffRedeem } from "./handoff";
import { handleMe, handleUseTelegram } from "./me";
import { handleScheduled, type SchedulerEnv } from "./scheduler";
import { handleSubscriptions } from "./subscriptions";
import { handleSync } from "./sync";
import { handlePasskey } from "./passkeys";
import { handleTgLink, handleTgUnlink, handleTgWebhook } from "./telegram";

// Passkey routes are /api/passkey/{register,login}/{options,verify} (Tech_Scope.md §8, ADR-0005).
const PASSKEY_PREFIX = "/api/passkey/";

// Web push subscribe and unsubscribe are /api/push/{subscribe,unsubscribe} (Tech_Scope.md §10 slice 18, ADR-0002).
const PUSH_PREFIX = "/api/push/";

// The Telegram webhook lives at /api/tg/<secret>; the secret is the rest of the path (Tech_Scope.md §6).
const TG_HOOK_PREFIX = "/api/tg/";

// One Worker serves the app, the API, and the cron on one origin (ADR-0004). wrangler.jsonc routes only
// /api/* here (`run_worker_first`); everything else is answered by the static-assets layer before this runs, with the
// SPA fallback. The ASSETS fall-through below is a safety net for requests that reach the Worker anyway.
// Audit #34: a script calling /api/* with no cookie can still write rows (a Telegram link code, a passkey challenge) and use
// up D1's free 100k writes a day. One limit per IP address, per Cloudflare location (the binding is approximate by design).
// The Telegram webhook is left out: every update comes from Telegram's few addresses. No CF-Connecting-IP (local dev and
// tests) or no binding means no limit.
async function overLimit(request: Request, env: Env, pathname: string): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || !env.API_LIMIT || (pathname.startsWith(TG_HOOK_PREFIX) && pathname !== "/api/tg/link" && pathname !== "/api/tg/unlink")) return false;
  return !(await env.API_LIMIT.limit({ key: ip })).success;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname.startsWith("/api/") && (await overLimit(request, env, pathname)))
        return Response.json({ error: "rate_limited", detail: "too many requests; try again in a minute" }, { status: 429, headers: { "Retry-After": "60" } });
      if (pathname === "/api/sync") return await handleSync(request, env);
      if (pathname.startsWith(PASSKEY_PREFIX)) return await handlePasskey(request, env, pathname.slice(PASSKEY_PREFIX.length));
      if (pathname === "/api/tg/link") return await handleTgLink(request, env);
      if (pathname === "/api/tg/unlink") return await handleTgUnlink(request, env);
      if (pathname === "/api/handoff/redeem") return await handleHandoffRedeem(request, env);
      if (pathname.startsWith(PUSH_PREFIX)) return await handleSubscriptions(request, env, pathname.slice(PUSH_PREFIX.length));
      if (pathname === "/api/me") return await handleMe(request, env);
      if (pathname === "/api/channel/telegram") return await handleUseTelegram(request, env);
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
