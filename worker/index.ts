import { handleSync } from "./sync";

// One Worker serves the app, the API, and (later) the cron on one origin (ADR-0004). wrangler.jsonc routes only
// /api/* here (`run_worker_first`); everything else is answered by the static-assets layer before this runs, with the
// SPA fallback. The ASSETS fall-through below is a safety net for requests that reach the Worker anyway.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/api/sync") return await handleSync(request, env);
      if (pathname.startsWith("/api/")) return Response.json({ error: "not_found" }, { status: 404 });
      return await env.ASSETS.fetch(request);
    } catch (e) {
      console.error("unhandled", e);
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
