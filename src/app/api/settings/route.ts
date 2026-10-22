import { NextResponse } from 'next/server';
import { getUserSettings, saveUserSettings } from '@/lib/db';
import { UserSettings } from '@/types';

export async function GET() {
  try {
    const settings = await getUserSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const settings: UserSettings = await request.json();
    const updated = await saveUserSettings(settings);
    return NextResponse.json({ success: true, settings: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
