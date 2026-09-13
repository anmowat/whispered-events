import { NextRequest, NextResponse } from 'next/server'
import { verifySession, addShareContact, removeFollow } from '@/lib/supabase'
import { getUserById } from '@/lib/users'
import { toShareVisibility } from '@/lib/types'
import { waitUntil } from '@vercel/functions'
import { notifyEventShare } from '@/lib/slack'

// Follow a member who opted into share_visibility = 'everyone'.
//
// This is the one write path where a member creates a row on SOMEONE ELSE's
// contact list (owner = the person being followed, contact = the caller), so
// the authorization check is the whole point of the route: the target must
// currently be set to 'everyone'. It is re-checked on every read too, so
// switching back to 'contacts' revokes every follower at once even though
// their rows remain.
//
//   POST   { userId }  follow
//   DELETE { userId }  unfollow

async function requireSession(req: NextRequest) {
  const token = req.cookies.get('session')?.value
  if (!token) return null
  return verifySession(token)
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { userId?: unknown }
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (userId === session.userId) {
    return NextResponse.json({ error: "That's you." }, { status: 400 })
  }

  try {
    const target = await getUserById(userId)
    if (!target || !target.active) {
      return NextResponse.json({ error: 'That member could not be found.' }, { status: 400 })
    }
    // The authorization check. Without this, any member id would grant a
    // window onto that person's plans.
    if (toShareVisibility(target.shareVisibility) !== 'everyone') {
      return NextResponse.json(
        { error: 'That member is not sharing their events publicly.' },
        { status: 403 },
      )
    }

    // owner = the person being followed, contact = me. No invite mail: the
    // target is a member by definition, and the follower is the one acting.
    const { created } = await addShareContact(target.id, session.email, 'follow')

    if (created) {
      // Reported against the OWNER, since it's their events that just became
      // visible to someone new - even though the follower took the action.
      waitUntil(
        notifyEventShare({
          ownerUserId: target.id,
          ownerName: target.name,
          ownerEmail: target.email,
          ownerLinkedin: target.linkedin,
          contactEmail: session.email,
          method: 'follow',
          source: 'dashboard',
        }).catch((e) => console.error('dashboard/follow: notifyEventShare failed', e)),
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/follow POST error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { userId?: unknown }
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  try {
    // Scoped to the caller's own address inside removeFollow, and to
    // added_via = 'follow', so this can't delete a share someone deliberately
    // made to you.
    await removeFollow(userId, session.email)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/follow DELETE error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
