import { NextRequest } from 'next/server'
import { verifySession } from './supabase'
import { AirtableUser } from './airtable'
import { getUserByEmail } from './users'

// Resolves the current request's session cookie to the corresponding Airtable
// user record. Returns null if there's no session, the session is invalid, or
// no Airtable user matches the session email. Used by the host-* routes for
// "is this caller a real user we know about?" before they can list or edit
// events they host.
export async function getSessionUser(req: NextRequest): Promise<AirtableUser | null> {
  const token = req.cookies.get('session')?.value
  if (!token) return null
  const email = await verifySession(token)
  if (!email) return null
  return await getUserByEmail(email)
}
