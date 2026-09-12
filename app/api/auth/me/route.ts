import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getContributionStatsForUser } from '@/lib/supabase'
import { getUserByEmail } from '@/lib/users'

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value

  if (!sessionToken) {
    return NextResponse.json({ user: null })
  }

  const session = await verifySession(sessionToken)

  if (!session) {
    return NextResponse.json({ user: null })
  }

  const [user, stats] = await Promise.all([
    getUserByEmail(session.email),
    getContributionStatsForUser(session.userId),
  ])

  if (!user) {
    return NextResponse.json({ user: null })
  }

  return NextResponse.json({
    user: {
      email: user.email,
      name: user.name,
      interest: user.interest,
      location: user.location,
      employment: user.employment,
      companySize: user.companySize,
      function: user.function,
      linkedin: user.linkedin,
      seniority: user.seniority,
      status: user.status,
      active: user.active,
      frequency: user.frequency,
      // Event-sharing privacy. Sent here so the dashboard renders the View
      // row's label correctly on first paint instead of flipping from View to
      // Activate once a second request lands.
      findable: user.findable,
      shareVisibility: user.shareVisibility,
      // Sourced from Supabase `contributions` table.
      lastContribution: stats.lastAt,
      totalContributions: stats.total,
      contributionsLast30: stats.last30,
      contributionsLast90: stats.last90,
    },
  })
}
