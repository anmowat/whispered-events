import Link from 'next/link'
import { Wordmark } from '@/components/Wordmark'

// Magic-link interstitial. Email clients (Gmail, Outlook, corporate
// security scanners) pre-fetch URLs in incoming mail to check them for
// malware. If the magic-link URL itself consumed the token on GET, the
// scanner would burn the token before the recipient ever clicked,
// and the real click would then redirect to /?auth=invalid. So this
// page sits between the email and /api/auth/verify: GET renders a
// button, and the actual token consumption only happens when the
// button POSTs the form below.
export default function MagicLinkLoginPage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  const token = (searchParams.token ?? '').trim()

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#1b1814', color: '#ece6da' }}
    >
      <div
        className="w-full max-w-[420px] rounded-card border p-7 space-y-5"
        style={{
          background: '#252220',
          borderColor: 'rgba(236,230,218,.13)',
        }}
      >
        <Wordmark size={18} />
        <div
          style={{
            height: 1,
            background: 'rgba(236,230,218,.13)',
            margin: '6px 0 0',
          }}
        />

        {token ? (
          <>
            <h2
              className="font-serif m-0"
              style={{
                fontSize: 30,
                lineHeight: 1.1,
                color: '#ece6da',
                letterSpacing: '-0.01em',
              }}
            >
              <span style={{ fontStyle: 'italic', color: '#c9a86a' }}>
                Welcome
              </span>{' '}
              back.
            </h2>
            <p
              className="m-0"
              style={{
                fontSize: 14,
                lineHeight: 1.55,
                color: 'rgba(236,230,218,.78)',
              }}
            >
              Tap below to sign in. We confirm the click here so email
              security scanners can&rsquo;t accidentally burn your link.
            </p>
            <form method="POST" action="/api/auth/verify">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full py-3 rounded-pill text-[14px] font-semibold transition-colors"
                style={{
                  background: '#c9a86a',
                  color: '#1b1814',
                  letterSpacing: '.01em',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Sign me in
              </button>
            </form>
            <p
              className="m-0"
              style={{
                fontSize: 12,
                lineHeight: 1.55,
                color: 'rgba(236,230,218,.5)',
              }}
            >
              Links expire 15 minutes after we send them and can only be
              used once.
            </p>
          </>
        ) : (
          <>
            <h2
              className="font-serif m-0"
              style={{
                fontSize: 26,
                lineHeight: 1.15,
                color: '#ece6da',
                letterSpacing: '-0.01em',
              }}
            >
              Sign-in link missing.
            </h2>
            <p
              className="m-0"
              style={{
                fontSize: 14,
                lineHeight: 1.55,
                color: 'rgba(236,230,218,.78)',
              }}
            >
              This page needs a one-time token from your email. Request a
              fresh link from the homepage.
            </p>
            <Link
              href="/"
              className="inline-block w-full text-center py-2.5 rounded-pill text-[13px] font-semibold transition-colors"
              style={{
                background: '#c9a86a',
                color: '#1b1814',
                letterSpacing: '.01em',
              }}
            >
              Back to Whispered Events
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
