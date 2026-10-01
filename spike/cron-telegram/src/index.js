// Spike: cron -> D1 -> Telegram. Throwaway; proves the phase-2 spine only.
export default {
  async scheduled(event, env) {
    const { results } = await env.DB.prepare(
      "SELECT id, chat_id, text, due_at FROM reminders WHERE sent_at IS NULL AND due_at <= ?"
    ).bind(event.scheduledTime).all();

    for (const r of results) {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: r.chat_id, text: r.text }),
      });
      // ponytail: failed sends stay unsent and retry next minute; no backoff or dead-letter in a spike
      if (!res.ok) { console.log(`send ${r.id} failed: ${res.status} ${await res.text()}`); continue; }
      await env.DB.prepare("UPDATE reminders SET sent_at = ? WHERE id = ?").bind(Date.now(), r.id).run();
      console.log(`sent ${r.id}, ${Date.now() - r.due_at} ms after due`);
    }
  },
};
