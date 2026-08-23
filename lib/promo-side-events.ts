// TEMPORARY — DELETE THIS FILE AFTER 2026-09-18, along with the five
// `sideEventsPromo` call sites in lib/email.ts (search for `promo.html`).
//
// Dreamforce / Unbound side-events promo, appended below the event list in the
// digest family of emails. Three mutually exclusive variants, chosen by
// proximity to the host city first, then by go-to-market relevance.

import type { AirtableUser } from './airtable'
import { withinMiles } from './geocode'
import { parseTopics, hasTopic } from './topics'
import { C, SANS, SERIF } from './email'

// End of day 2026-09-18 Pacific, by which point both conferences are over.
// Written as the UTC instant of midnight PT on the 19th (PDT = UTC-7 in
// September) so the cutoff lands at the same real moment wherever this runs.
// `new Date('2026-09-18')` would parse as UTC midnight and cut the promo
// 17 hours early for a US audience.
const PROMO_ENDS_AT_MS = Date.UTC(2026, 8, 19, 7, 0, 0)

// Downtown anchors for the two host cities. 100 miles around Boston reaches
// Providence, Worcester and Manchester; around San Francisco it covers the Bay
// Area, Sacramento and Santa Cruz.
const BOSTON = { lat: 42.3601, lng: -71.0589 }
const SAN_FRANCISCO = { lat: 37.7749, lng: -122.4194 }

// Deliberately a literal rather than NEARBY_RADIUS_MILES. The two share a value
// today but mean different things — retuning the match radius must not silently
// retarget this promo.
const PROMO_RADIUS_MILES = 100

const SITE = 'https://www.whisperedevents.com'
const UTM = '?utm_source=email&utm_medium=digest&utm_campaign=side-events-26'

// Ampersands must be entity-encoded inside HTML attributes; the plain form is
// what belongs in the plain-text alternative. Keep the URL constants plain and
// encode at the point of interpolation.
function attr(url: string): string {
  return url.replace(/&/g, '&amp;')
}

const DREAMFORCE_URL = `${SITE}/dreamforce${UTM}`
const UNBOUND_URL = `${SITE}/unbound${UTM}`
const DREAMFORCE_IMG = `${SITE}/banners/dreamforce-26-banner.png`
const UNBOUND_IMG = `${SITE}/banners/unbound-26-banner.png`

const DREAMFORCE_LABEL = 'See our list of the best Dreamforce Side Events'
const UNBOUND_LABEL = 'See our list of the best Unbound Side Events'

// The Functions group of DEFAULT_TOPICS (lib/topics.ts). Compared exactly and
// case-insensitively via hasTopic.
const RELEVANT_TOPICS = [
  'Marketing',
  'Marketing Ops',
  'Demand Gen',
  'Sales',
  'Sales Development',
  'RevOps',
  'GTM',
  'Customer Success',
  'Customer Experience',
  'Enablement',
  'GTM Engineering',
]

// `function` is LLM-classified from a LinkedIn profile and isn't constrained to
// an enum at write time, so it gets substring matching rather than equality.
const RELEVANT_FUNCTION_SUBSTRINGS = [
  'sales',
  'marketing',
  'revops',
  'rev ops',
  'revenue operations',
  'customer success',
  'customer experience',
  'enablement',
  'gtm',
  'go-to-market',
  'go to market',
]

function isRelevant(user: Pick<AirtableUser, 'interest' | 'function'>): boolean {
  const topics = parseTopics(user.interest ?? '')
  if (RELEVANT_TOPICS.some((t) => hasTopic(topics, t))) return true
  const fn = (user.function ?? '').toLowerCase()
  return fn ? RELEVANT_FUNCTION_SUBSTRINGS.some((s) => fn.includes(s)) : false
}

function nearCity(
  user: Pick<AirtableUser, 'lat' | 'lng'>,
  city: { lat: number; lng: number },
): boolean {
  // Un-geocoded users arrive as undefined (lib/users.ts coerces anything
  // non-finite). They're unknown rather than "outside", so they fall through to
  // the relevance-gated variant instead of being excluded here.
  const { lat, lng } = user
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return withinMiles({ lat, lng }, city, PROMO_RADIUS_MILES)
}

// A linked banner. Every attribute here is load-bearing in some client:
//
//   table wrapper  Outlook's Word engine ignores margin on <img> and won't
//                  reliably centre a block image. Same shape as accentButton.
//   width=""       an HTML attribute, because Word ignores CSS width and would
//                  otherwise lay the image out at its intrinsic 1048px and
//                  burst the 600px card. 536 = 600 - 32 padding x 2.
//   no height      a fixed height fights the fluid width on mobile and squashes
//                  the banner. The cost is that a blocked image collapses to
//                  alt-text height rather than reserving space, which is the
//                  better failure.
//   border         attribute and CSS: Outlook draws a blue link border on
//                  linked images, and the two builds read different ones.
//   display:block  removes the inline-image baseline gap.
//   bicubic        Outlook 2007-2016 downscale nearest-neighbour otherwise, and
//                  1048 -> 536 visibly aliases the banner text.
//   font/colour    blocked-image alt text inherits the img's own styles, so the
//                  fallback reads as an accent-coloured chip instead of default
//                  blue Times.
//
// The 1048px asset shown at 536 CSS px is already the 2x image, so there's no
// srcset — support is inconsistent across Gmail, Outlook and Yahoo and it would
// only add a second URL to get wrong.
function banner(href: string, src: string, alt: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:14px 0 0;">
  <tr>
    <td align="center" style="padding:0;">
      <a href="${attr(href)}" style="display:block;text-decoration:none;">
        <img src="${attr(src)}" alt="${alt}" width="536" border="0" style="display:block;width:100%;max-width:536px;height:auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;border-radius:6px;background:${C.accentSoft};font-family:${SANS};font-size:13px;line-height:1.5;color:${C.accent};">
      </a>
    </td>
  </tr>
</table>
`.trim()
}

function headline(text: string): string {
  return `<div style="font-family:${SERIF};font-size:22px;font-weight:600;color:${C.ink};line-height:1.2;margin:0;">${text}</div>`
}

// The text CTA, rendered for every variant independently of the banner. This is
// what makes the block safe with images blocked: it still reads and still
// clicks, and the image is decoration on top.
function subline(href: string, label: string): string {
  return `<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:8px 0 0;"><a href="${attr(href)}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">${label}</a> &rarr;</p>`
}

function wrap(inner: string): string {
  return `
<div style="margin:26px 0 0;padding:20px 0 0;border-top:1px solid ${C.rule};">
  ${inner}
</div>
`.trim()
}

/**
 * The promo block for one recipient, or empty strings when nothing should show.
 *
 * Returning empties rather than null lets all five call sites interpolate
 * unconditionally — the same contract as moreOnDashboardHtml.
 *
 * Takes a Pick and an injectable `now` so it can be tested without building a
 * full AirtableUser or waiting for a date.
 */
export function sideEventsPromo(
  user: Pick<AirtableUser, 'lat' | 'lng' | 'interest' | 'function'>,
  now: Date = new Date(),
): { html: string; textLines: string[] } {
  const empty = { html: '', textLines: [] as string[] }
  if (now.getTime() >= PROMO_ENDS_AT_MS) return empty

  // Near Boston — Unbound only.
  if (nearCity(user, BOSTON)) {
    return {
      html: wrap(
        [
          headline('Attending Unbound?'),
          subline(UNBOUND_URL, UNBOUND_LABEL),
          banner(UNBOUND_URL, UNBOUND_IMG, `${UNBOUND_LABEL} →`),
        ].join('\n'),
      ),
      textLines: ['Attending Unbound?', `${UNBOUND_LABEL}: ${UNBOUND_URL}`],
    }
  }

  // Near San Francisco — Dreamforce only.
  if (nearCity(user, SAN_FRANCISCO)) {
    return {
      html: wrap(
        [
          headline('Attending Dreamforce?'),
          subline(DREAMFORCE_URL, DREAMFORCE_LABEL),
          banner(DREAMFORCE_URL, DREAMFORCE_IMG, `${DREAMFORCE_LABEL} →`),
        ].join('\n'),
      ),
      textLines: ['Attending Dreamforce?', `${DREAMFORCE_LABEL}: ${DREAMFORCE_URL}`],
    }
  }

  // Everyone else, but only if they look go-to-market relevant.
  if (!isRelevant(user)) return empty
  return {
    html: wrap(
      [
        headline('Are you traveling to Dreamforce or Unbound?'),
        // One subline per page rather than a single "our side events pages"
        // link, which could only point at one of the two.
        subline(DREAMFORCE_URL, 'Dreamforce side events'),
        banner(DREAMFORCE_URL, DREAMFORCE_IMG, `${DREAMFORCE_LABEL} →`),
        subline(UNBOUND_URL, 'Unbound side events'),
        banner(UNBOUND_URL, UNBOUND_IMG, `${UNBOUND_LABEL} →`),
      ].join('\n'),
    ),
    textLines: [
      'Are you traveling to Dreamforce or Unbound?',
      `Dreamforce side events: ${DREAMFORCE_URL}`,
      `Unbound side events: ${UNBOUND_URL}`,
    ],
  }
}
