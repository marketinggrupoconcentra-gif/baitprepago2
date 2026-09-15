import { NextRequest, NextResponse } from 'next/server';
import { logError, logInfo } from '@/lib/log';

export const runtime = 'nodejs';

interface CampaignMetric {
  id: string;
  name: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    
    // Verificación de seguridad básica
    const expectedSecret = process.env.GOOGLE_ADS_WEBHOOK_SECRET;
    
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { date, campaigns } = payload as { date: string; campaigns: CampaignMetric[] };
    
    if (!campaigns || !Array.isArray(campaigns)) {
      return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 });
    }

    logInfo('/api/webhooks/google-ads', 'POST', { date, campaignCount: campaigns.length });

    return NextResponse.json({ 
      success: true, 
      message: 'Métricas de Google Ads recibidas correctamente',
      receivedCount: campaigns.length 
    });

  } catch (error: unknown) {
    const err = error as Error;
    logError('/api/webhooks/google-ads', 'POST', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
