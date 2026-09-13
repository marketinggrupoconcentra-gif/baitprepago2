import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicId(value: string | undefined, pattern: RegExp): string | null {
  const normalized = value?.trim() ?? '';
  return pattern.test(normalized) ? normalized : null;
}

/** Public measurement IDs only. No credentials or API tokens are exposed here. */
export async function GET(): Promise<NextResponse> {
  const gtmId = await getSetting('gtm_id', process.env.NEXT_PUBLIC_GTM_ID);
  const ga4Id = await getSetting('ga4_id', process.env.NEXT_PUBLIC_GA4_ID);
  const metaPixelId = await getSetting('meta_pixel_id', process.env.NEXT_PUBLIC_META_PIXEL_ID);

  const payload = {
    gtmId: publicId(gtmId, /^GTM-[A-Z0-9]{4,10}$/),
    ga4Id: publicId(ga4Id, /^G-[A-Z0-9]{5,15}$/),
    metaPixelId: publicId(metaPixelId, /^\d{10,20}$/),
    gclidParam: process.env.NEXT_PUBLIC_GCLID_PARAM ?? 'gclid',
    fbclidParam: process.env.NEXT_PUBLIC_FBCLID_PARAM ?? 'fbclid',
    ttclidParam: process.env.NEXT_PUBLIC_TTCLID_PARAM ?? 'ttclid',
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}
