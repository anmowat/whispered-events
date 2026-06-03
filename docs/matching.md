# How Whispered Events scores matches

A match score answers one question: *should this user be emailed about this event?* Every (user, event) pair gets a single number between 0 and 3.375. Anything at or above 1.0 (≈ 30%) clears the threshold and enters the user's dashboard + digest pool.

The score is a product of four signals — three deterministic, one judged by an LLM. Multiplicative on purpose: a weak signal anywhere drags the total down, so we never email someone who fails on location, level, or fit.

```
score = location × audience × quality × preferences
```

| Signal       | Range          | Who decides            | What it captures                                  |
|--------------|----------------|------------------------|---------------------------------------------------|
| Location     | 0 or 1         | Deterministic (geo)    | Is the user within 100 miles of the event city?   |
| Audience     | 0.0 – 1.5      | LLM (Claude Haiku)     | Does the event's stated audience match the user's role + seniority? |
| Quality      | 0.25 – 1.5     | Deterministic (grade)  | How vetted is this user?                          |
| Preferences  | 0.0 – 1.5      | LLM (Claude Haiku)     | Does the event match what the user said they want to attend? |

Max possible score: `1 × 1.5 × 1.5 × 1.5 = 3.375` (≈ 100%).
Notify threshold: `1.0` (≈ 30%).

---

## 1. Location (0 or 1)

Binary. The event has a geocoded location, the user has a geocoded location, and the great-circle distance between them is **≤ 100 miles**. If yes, 1. If no, 0.

Virtual events score 0 by definition — we no longer accept them, and any that slip through get filtered out here.

A 0 here short-circuits the whole calculation: no LLM call, no audience or preferences scoring, no row in the match table. The user is recorded as `skipped_reason = 'location_zero'` and never sees the event. This is how we keep the LLM budget sane (most pairs are out-of-region and we want to skip them cheap).

---

## 2. Audience (0.0 – 1.5)

The LLM reads the event's stated audience and type and compares it to the user's function and seniority. Anchored to a fixed rubric:

| Score | When                                                                                                |
|-------|-----------------------------------------------------------------------------------------------------|
| 1.5   | Event audience literally names this attendee's function **AND** seniority. *Example: event audience "Marketing VP/Directors, CMO" for a C-level Marketing attendee.* |
| 1.2   | Event audience literally names the function **OR** the seniority, but not both.                     |
| 0.9   | Adjacent role/seniority. *Example: a CEO at a RevOps-leaders event — same domain, different practitioner level. Or a VP of Marketing at a CMO-only dinner.* |
| 0.5   | Tangential overlap (one shared theme, mostly off-target).                                           |
| 0.0   | Wrong audience entirely.                                                                            |

Industry context (SaaS vs VC vs services etc.) can drop the score by at most one tier — function + seniority overlap dominates. We're matching jobs to events, not branding to industries.

---

## 3. Quality (0.25 – 1.5)

A flat multiplier based on the user's grade in Airtable. Set at signup or admin review.

| Grade  | Multiplier | Meaning                                                  |
|--------|------------|----------------------------------------------------------|
| A      | 1.5        | Vetted, strong fit for what Whispered is for.            |
| Polish | 1.0        | Solid baseline — profile is clear, role + seniority check out. |
| B      | 0.5        | On platform but down-weighted in matching.               |
| C      | 0.25       | Doesn't reach the notify threshold under any combination — short-circuited, no LLM call. Same handling as location 0. |

The Grade-C short-circuit exists for the same reason as the location short-circuit: math says they can never clear 1.0, so we don't pay the Claude tokens to confirm it.

---

## 4. Preferences (0.0 – 1.5)

The LLM reads the user's stated event interests (the free-text field on their profile) and compares it to the event's name, audience, and description. Same anchor-driven rubric as audience:

| Score | When                                                                                                |
|-------|-----------------------------------------------------------------------------------------------------|
| 1.5   | Stated interest matches the event's name, audience, or description literally or near-literally. *Example: interest "RevOps events" + event "RevOps Leaders Dinner" → 1.5. Interest "marketing" + audience "CMO/Marketing VP" → 1.5.* |
| 1.2   | Strong semantic match. *Example: interest "GTM" + event for "Sales + Marketing leaders".*           |
| 1.0   | Interests not stated, or neutral — no signal either way. The default for users who skip the field.  |
| 0.5   | Weak overlap — one tangential keyword.                                                              |
| 0.0   | Attendee explicitly excluded this kind of event. *Example: interest reads "no sales events".*       |

The 1.0 default for users who didn't fill in interests is intentional: we don't punish them. Their score then relies on audience + location + quality, exactly as if the field didn't exist.

---

## How the math plays out

A few worked examples to make the formula concrete.

**Strong match.** A-grade Marketing C-level in SF, interest "marketing"; event "Humans of GTM" in SF, audience includes "CMO" + "Marketing VP/Directors":

```
1 (location)  ×  1.5 (audience: literal function + seniority)
              ×  1.5 (quality: A)
              ×  1.5 (preferences: "marketing" literal in audience)
            = 3.375  →  100%
```

**Adjacent match.** A-grade CEO in NY, interest "RevOps events"; event "RevOps Leaders Dinner" in NY, audience "RevOps Leaders, Operations Directors, Revenue Operations Professionals":

```
1 (location)  ×  0.9 (audience: CEO is adjacent to RevOps practitioners)
              ×  1.5 (quality: A)
              ×  1.5 (preferences: "RevOps events" matches event title verbatim)
            = 2.025  →  60%
```

**Below threshold.** Polish-grade Sales VP in SF, no stated interests; event "CMO Summit" in SF, audience "CMOs only":

```
1 (location)  ×  0.5 (audience: tangential — different function)
              ×  1.0 (quality: Polish)
              ×  1.0 (preferences: not stated, neutral default)
            = 0.500  →  15%
```

This one doesn't clear 1.0, so it stays off the user's dashboard and never goes into a digest.

---

## What scoring does NOT consider

By design:

- **Company industry.** A Marketing leader at a venture firm scores the same as a Marketing leader at a SaaS, on a SaaS-focused GTM event. Their function is what we're matching.
- **Event recency or how new it is to the platform.** Freshness is handled by the digest's "New" vs "Top Matches" sections (`lib/email.ts`), not by the score itself.
- **Who else is attending.** Audience is judged by the event's stated targeting, not by who's already RSVP'd.
- **Whether the user already saw an earlier email about this event.** That's the `notified_at` column in Supabase — the score doesn't change once a user has been notified.

---

## Where this lives in the code

- `lib/matching.ts` — `scoreEventUser` runs the whole formula; `callLLM` makes the Claude Haiku call that returns audience + preferences in a single tool call. Inputs are SHA-hashed (`computeInputsHash`) so an unchanged (event, user) pair re-uses its cached row instead of paying for a new LLM call.
- `app/api/process-matches/route.ts` — the worker that runs scoring. Triggered on event creation/edit (`trigger=event&id=...`), on user signup/profile update (`trigger=user&id=...`), or from the admin "Rescore missing matches" button (`/api/admin/rescore-missing`).
- `lib/supabase.ts` — `matches` table holds one row per scored pair: score, the four component scores, `notified_at`, and a `skipped_reason` for short-circuited rows (Grade C, location 0).
