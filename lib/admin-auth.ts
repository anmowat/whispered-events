import { NextRequest } from 'next/server'
import { verifySession } from './supabase'

// Admin auth: session cookie email must be in ADMIN_EMAILS allowlist
// (comma-separated env var, case-insensitive). Shared between admin API
// routes and any server components that need to gate on admin.

export async function isAdmin(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get('session')?.value
  if (!token) return false
  const email = await verifySession(token)
  if (!email) return false
  const allow = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return allow.includes(email.toLowerCase())
}
