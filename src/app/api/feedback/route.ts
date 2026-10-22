import { NextResponse } from 'next/server';
import { updateSenderFeedback } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { sender, action } = await request.json();
    if (!sender || !action) {
      return NextResponse.json({ success: false, error: 'Sender and action are required' }, { status: 400 });
    }
    const newScore = await updateSenderFeedback(sender, action);
    return NextResponse.json({ success: true, sender, action, sender_score: newScore });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
