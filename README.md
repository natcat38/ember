# Ember

A free web app for one overwhelmed person with too many deadline tasks. Drop a task in one line; Ember turns it into a first small step, shows you at most five things today, and reminds you through the day in a voice that encourages rather than nags. An orange tabby cat keeps you company. Desktop and phone, synced, zero running cost.

Status: Build stage, phase 1. See `ROADMAP.md` and `docs/Tech_Scope.md`.

## Run it

```
npm install
npm run dev
```

`npm run typecheck` and `npm test` are what CI runs. `npm run deploy` builds and ships the `ember-tasks` Worker (Cloudflare, static assets only in phase 1).
