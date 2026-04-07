import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date')

  // Bestem dato — 'latest' eller specifik dato
  let query = supabase
    .from('aiss_merkle_roots')
    .select('merkle_date, root_hash, voyage_count, created_at')

  if (dateParam && dateParam !== 'latest') {
    query = query.eq('merkle_date', dateParam)
  } else {
    query = query.order('merkle_date', { ascending: false }).limit(1)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  return NextResponse.json({
    date:         data.merkle_date,
    root_hash:    data.root_hash,
    voyage_count: data.voyage_count,
    published_at: data.created_at,
    verify:       'https://aiss.network/v1/merkle/verify',
  }, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
