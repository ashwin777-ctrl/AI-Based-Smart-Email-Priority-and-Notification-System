import { NextResponse } from 'next/server';
import { getEmails, addOrUpdateEmail } from '@/lib/db';
import { Email } from '@/types';

export async function GET() {
  try {
    const emails = await getEmails();
    return NextResponse.json({ success: true, emails });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const email: Email = await request.json();
    await addOrUpdateEmail(email);
    return NextResponse.json({ success: true, email });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
