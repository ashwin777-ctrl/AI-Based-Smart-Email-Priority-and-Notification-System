import { NextResponse } from 'next/server';
import { classifyEmail } from '@/lib/classifier';
import { getRules, getSenderScores, getUserSettings } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { subject, message, sender, category = 'inbox', hour } = await request.json();
    const [rules, scores, settings] = await Promise.all([
      getRules(),
      getSenderScores(),
      getUserSettings(),
    ]);

    const result = classifyEmail(subject, message, sender, category, hour, rules, scores, settings);
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
