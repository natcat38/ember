# ADR-0007: Workers AI for the phase-4 breakdown, capped at 5 per user per day

**Status:** Accepted
**Date:** 2026-10-02
**Deciders:** Natalie

## Context

*Break this down for me* calls a free-tier LLM behind the API, with a daily cap whose number depends on the provider (Product_Scope decision 5, `UX_Flows.md` §3.3). It ships in phase 4.

## Decision

Use Cloudflare Workers AI with `@cf/meta/llama-3.1-8b-instruct-awq` through the Worker's `AI` binding. Cap: **5 presses per user per day**, plus a global stop at **800 calls a day**. Either cap shows *"Out of breakdowns for today. Try: what's the very next physical action?"*

**The numbers** (Workers AI pricing page, updated 2026-10-01): the free plan includes 10,000 neurons a day, and calls fail with an error past it. This model costs 11,161 neurons per million input tokens and 24,215 per million output tokens. A breakdown of about 400 tokens in and 250 out costs about 4.5 + 6.1 ≈ 10.5 neurons, so 10,000 neurons ≈ 950 calls. 800 leaves headroom.

## Options considered

| Option | Why it lost |
|---|---|
| **Workers AI (chosen)** | — |
| Google Gemini free tier | Needs an API key secret and a second vendor. Free-tier prompts may be used for training, which is a poor fit for personal task text. |
| Groq or OpenRouter free models | Second vendor, and free-tier terms have shifted often. |
| `@cf/ibm-granite/granite-4.0-h-micro` (cheaper on Workers AI) | About 3 neurons a call, but a micro model is weaker at following a "3 to 6 steps, as JSON" instruction. Revisit if the cap binds. |

## Consequences

- No new vendor, no secret, no extra bill.
- About 160 users pressing the button 5 times every day reach the global stop. Revisit if phase 4 has that many.
- Re-check pricing when phase 4 starts; it is the most volatile number in this scope.
