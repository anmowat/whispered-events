import type { Metadata } from 'next'
import JsonLd from '@/components/seo/JsonLd'
import { buildFaqNode, SITE_URL, type FaqItem } from '@/lib/seo/schema'

const PAGE_URL = `${SITE_URL}/faq`

// Without an explicit canonical here this page inherits `canonical: '/'` from
// the root layout, which tells Google it's a duplicate of the homepage.
export const metadata: Metadata = {
  title: 'FAQ — how Whispered Events works | Whispered Events',
  description:
    'How Whispered Events matches executives to invitation-only dinners, conferences and gatherings — what events we cover, how matching works, who qualifies, what data we collect, and why it is free.',
  alternates: { canonical: '/faq' },
  openGraph: {
    title: 'FAQ — how Whispered Events works',
    description:
      'How Whispered Events matches executives to invitation-only dinners, conferences and gatherings.',
    url: PAGE_URL,
    siteName: 'Whispered Events',
    type: 'website',
  },
}

// Plain-text mirrors of the answers rendered in page.tsx. These must stay in
// sync with the visible copy — marking up an answer that isn't on the page is a
// structured-data policy violation.
const FAQS: FaqItem[] = [
  {
    question: 'What types of events do you have?',
    answer:
      'We focus on in-person, director / VP / C-suite level events. We have events around the world, with concentrations in the obvious big cities in North America. You can browse the top topics on our platform, and add your own topics too.',
  },
  {
    question: 'How are matches determined?',
    answer:
      'We match events on three dimensions. Location: we match you to events within 150 miles of your location, with a higher match score for closer events, and you can update your location anytime in your dashboard. Audience: the match between the event’s target audience and information we pull from your LinkedIn (function, seniority, work experience) plus info you provide, such as employment status. Interests: the match between the event description and your stated interests.',
  },
  {
    question: 'How do I improve my matches?',
    answer:
      'Give us feedback — in email or on your dashboard — on each event we send you. It helps us improve the matching algorithm for everyone and improve your matches.',
  },
  {
    question: 'Can I have more than one location for matches?',
    answer:
      'We have consciously started by allowing one location for event matches at a time, because we are focused on helping executives find quality events rather than becoming a tool for selling. If you are traveling you can easily update your location to see matches in a new city. We will explore multi-location functionality for top contributors in the future.',
  },
  {
    question: 'Do I qualify for Whispered Events?',
    answer:
      'Whispered Events skews executive-level, but we default to admitting everyone who applies — assuming you are positive, professional and constructive — as long as your profile matches your LinkedIn. Instead of sending every event to every user, we use your profile and interests to surface the ones that actually fit. Final say belongs to each organizer: they decide who attends, we just point you to the right rooms.',
  },
  {
    question: 'What data do you collect, and how is it used?',
    answer:
      'At signup, we collect your LinkedIn profile, email, employment status, interests, and location. We never share your email but may share your other information with partners running events you match for.',
  },
  {
    question: 'Is Whispered Events really free?',
    answer:
      'Yes, Whispered Events is 100% free. Andy, the founder of Whispered, is passionate about connecting people and the power of events.',
  },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={{ '@context': 'https://schema.org', ...buildFaqNode(FAQS, PAGE_URL) }} />
      {children}
    </>
  )
}
