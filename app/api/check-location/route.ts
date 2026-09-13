import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { NEARBY_RADIUS_MILES } from '@/lib/matching'
import { geocodeLocationDetailed } from '@/lib/geocode'

// Quality check for user-entered locations at signup + dashboard edit.
// Catches three failure modes the downstream Nominatim geocoder will
// either silently miss or drop noise on:
//
//   - Typos ("San Fransisco") — geocoder may guess wrong city
//   - Extra noise ("Phoenix, AZ but I'm open to anywhere") — geocoder
//     fails the query entirely
//   - Ambiguity ("Springfield" with no state) — geocoder picks one,
//     probably not the user's
//
// Famous cities are accepted bare ("San Francisco", "NYC", "New York",
// "Atlanta"). The check fails open on any LLM error so a flaky API
// never blocks a save.

export const maxDuration = 30

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface CheckResponse {
  ok: boolean
  message?: string
  suggestion?: string
  /** Set when the geocoder itself could not find the place. The UI must NOT
   *  offer a "keep what you wrote" override in that case - forcing an
   *  un-geocodable location through is exactly the bug this check exists to
   *  stop, since matching is radius-based and silently does nothing without
   *  coordinates. */
  hardFail?: boolean
}

/**
 * The authoritative check: can the geocoder actually place this?
 *
 * The LLM pass below judges whether the STRING looks clean. That is a
 * different question, and it is why locations were reaching the database
 * without coordinates - Claude approved the text, then Nominatim failed later
 * with nobody watching. Only the geocoder can answer this one.
 */
async function geocodeCheck(location: string): Promise<CheckResponse> {
  const { coords, providersAnswered } = await geocodeLocationDetailed(location)
  if (coords) return { ok: true }

  if (!providersAnswered) {
    // Every provider was unreachable. Let them through: an outage must not
    // halt signups. The row lands without coordinates and shows up in admin,
    // which is recoverable; a blocked signup is not.
    console.error(
      'check-location: all geocode providers failed, accepting unverified location',
      { location },
    )
    return { ok: true }
  }

  // Providers answered and none of them know this place.
  return {
    ok: false,
    hardFail: true,
    message: `We couldn't find "${location}" on the map, so we wouldn't be able to match you to nearby events. Could you give a city — for example "San Francisco, CA"?`,
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<CheckResponse>> {
  let body: { location?: string }
  try {
    body = (await req.json()) as { location?: string }
  } catch {
    return NextResponse.json({ ok: true })
  }
  const location = (body.location || '').trim()
  if (!location) {
    return NextResponse.json({ ok: true })
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      temperature: 0,
      tools: [
        {
          name: 'submit_evaluation',
          description: 'Evaluate whether the location text is clean enough to geocode unambiguously.',
          input_schema: {
            type: 'object',
            properties: {
              ok: {
                type: 'boolean',
                description: 'true if the location is unambiguous and geocoder-ready. false if there is a typo, extra noise that would confuse the geocoder, or ambiguity that needs disambiguation.',
              },
              message: {
                type: 'string',
                description: 'When ok=false, a short friendly one-sentence explanation of what is wrong (e.g. "Looks like a typo — did you mean X?", "There is extra text after the city — should we use just X?", "Which Springfield? Add a state.").',
              },
              suggestion: {
                type: 'string',
                description: 'When ok=false AND a corrected location can be confidently inferred (typo fix or noise stripped), the cleaned form. Omit when the location is too ambiguous to guess.',
              },
            },
            required: ['ok'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_evaluation' },
      messages: [
        {
          role: 'user',
          content: `You evaluate user-entered "Location" answers for an executive event matching platform. We feed the location to a geocoder (OpenStreetMap Nominatim) to compute lat/lng, then match the user to events within ${NEARBY_RADIUS_MILES} miles.

Ideal format is "City, State, Country" or "City, Country". Famous cities are fine bare: "San Francisco", "NYC", "New York", "Atlanta", "London", "Paris", "Tokyo".

The user wrote: "${location}"

Set ok=false (and ask the user to confirm before we save) when:
- MULTIPLE CITIES: the input contains more than one city name — comma-separated list of cities (e.g. "San Francisco, New York", "Boston, Chicago, LA"), slash-separated cities ("NYC/LA"), or cities joined by "and"/"or" ("Austin and Denver"). Important: "City, State" (e.g. "Austin, TX") and "City, Country" (e.g. "London, UK") are NOT multiple cities — those are fine. Look for patterns like two recognizable city names side by side. Do NOT provide a suggestion; the message should be "It looks like you've entered more than one city — we can only match you to one location at a time. Please enter a single city."
- TYPO: a recognizable misspelling of a real city (e.g. "San Fransisco" → suggestion "San Francisco, CA"; "Atalnta" → "Atlanta, GA"). Provide the corrected suggestion.
- EXTRA NOISE: clean place name plus extra commentary (e.g. "Phoenix, AZ but I'm open to anywhere" → suggestion "Phoenix, AZ"; "based in Austin, TX, traveling a lot" → suggestion "Austin, TX"). Strip the noise; provide the clean suggestion.
- AMBIGUOUS: a name that could refer to multiple places without a disambiguator (e.g. "Springfield" alone, "Portland" alone, "Cambridge" alone). Do NOT provide a suggestion; ask in the message which one they mean.
- NOT A PLACE: too vague to geocode (e.g. "the bay area", "anywhere", "remote", "USA", just "California"). Provide a message asking for a specific city; omit suggestion or suggest a likely metro if obvious.

Set ok=true when:
- Famous bare city (San Francisco, NYC, New York, Atlanta, London, etc.)
- City + State (e.g. "Austin, TX", "Portland, OR")
- City + Country (e.g. "London, UK", "Tokyo, Japan")
- City + State + Country (e.g. "Austin, TX, USA")
- A clearly identifiable smaller city even bare, if unambiguous (e.g. "Boise" → ok, only one famous Boise)

When ok=false, the message should be one short friendly sentence. Be helpful, not condescending. When you can confidently suggest a correction, include it in the suggestion field so the UI can offer a one-click "use this" option.`,
        },
      ],
    })

    const toolUse = message.content.find((c) => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ ok: true })
    }
    const input = toolUse.input as {
      ok?: boolean
      message?: string
      suggestion?: string
    }
    if (input.ok === false) {
      const suggestion = (input.suggestion || '').trim()
      return NextResponse.json({
        ok: false,
        message: (input.message || '').trim() || 'We want to double-check this location before saving.',
        suggestion: suggestion || undefined,
      })
    }
    // The string reads clean — now find out whether it actually geocodes.
    return NextResponse.json(await geocodeCheck(location))
  } catch (err) {
    console.error('check-location: LLM call failed:', err)
    // The LLM is optional; the geocoder is not. Fall through to it rather than
    // failing fully open, which is how un-geocodable locations got saved.
    try {
      return NextResponse.json(await geocodeCheck(location))
    } catch (geoErr) {
      console.error('check-location: geocode also failed:', geoErr)
      return NextResponse.json({ ok: true })
    }
  }
}
