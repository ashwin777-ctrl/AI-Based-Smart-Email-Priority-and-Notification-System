import { NextResponse } from 'next/server';
import { getRules, addRule, deleteRule } from '@/lib/db';
import { BehaviorRule } from '@/types';

export async function GET() {
  try {
    const rules = await getRules();
    return NextResponse.json({ success: true, rules });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const rule: BehaviorRule = await request.json();
    const updated = await addRule(rule);
    return NextResponse.json({ success: true, rules: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { target, scope } = await request.json();
    const updated = await deleteRule(target, scope);
    return NextResponse.json({ success: true, rules: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
