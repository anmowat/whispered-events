import ConfirmRating from './ConfirmRating'

const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

const RATING_LABELS: Record<string, string> = {
  interested: 'Interested',
  skip: 'Skip',
  not_a_fit: 'Not a fit',
  // Legacy values still present in already-sent emails.
  going: 'Interested',
  cant_make_it: 'Skip',
}

// Server component on purpose. Reading the token from searchParams here (rather
// than with useSearchParams) keeps the <noscript> form in the server HTML — with
// a client-rendered page the whole boundary is empty until scripts run, which
// would leave a JavaScript-disabled reader with a blank page and no way to
// submit.
export default function RatePage({
  searchParams,
}: {
  searchParams: { token?: string; rating?: string }
}) {
  const token = searchParams.token ?? ''
  const rating = searchParams.rating ?? ''
  const label = RATING_LABELS[rating] ?? 'your rating'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#1b1814',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        fontFamily: SANS,
      }}
    >
      <div
        style={{
          background: '#251e19',
          border: '1px solid rgba(201,168,106,0.2)',
          borderRadius: 18,
          padding: '40px 36px',
          maxWidth: 440,
          width: '100%',
          textAlign: 'center',
        }}
      >
        <ConfirmRating token={token} rating={rating} label={label} />

        {/* No-JavaScript path: the client island never runs, so offer the same
            submission directly. Scanners don't submit forms, so this stays
            safe even for one that renders the page. */}
        <noscript>
          <form method="POST" action="/api/rate">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="rating" value={rating} />
            <button
              type="submit"
              style={{
                background: '#c9a86a',
                color: '#1b1814',
                borderRadius: 99,
                padding: '11px 26px',
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                fontFamily: SANS,
              }}
            >
              Confirm &ldquo;{label}&rdquo;
            </button>
          </form>
        </noscript>
      </div>
    </div>
  )
}
