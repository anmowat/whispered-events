// Server component. Renders a JSON-LD block into the initial HTML so non-JS
// crawlers can read it.

/**
 * `<` is escaped so a `</script>` sequence inside user-submitted event names or
 * descriptions can't break out of the script tag. JSON-LD parsers read the
 * < escape as a literal `<`, so nothing is lost.
 */
function serialize(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export default function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serialize(data) }}
    />
  )
}
