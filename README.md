# Ember

A free web app for one overwhelmed person with too many deadline tasks. Drop a task in one line; Ember turns it into a first small step, shows you at most five things today, and reminds you through the day in a voice that encourages rather than nags. An orange tabby cat keeps you company. Desktop and phone, synced, zero running cost.

Status: Build stage, phases 1–3 built and deployed. See `ROADMAP.md` and `docs/Tech_Scope.md`.

## Run it

```
npm install
npm run dev
```

`npm run typecheck` and `npm test` are what CI runs. Every push to `main` that passes CI deploys itself: GitHub Actions applies pending D1 migrations, then ships the `ember-tasks` Worker (Cloudflare). `npm run deploy` still works by hand.

## License

Code: MIT, see `LICENSE`. The cat artwork and app icons are not licensed for reuse. Security reports: see `SECURITY.md`.
