import { BehaviorRule, Email, ModelMetrics, SenderScore, UserSettings } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { classifyEmail, DEFAULT_SETTINGS } from './classifier';

export const INITIAL_EMAILS: Email[] = [
  {
    id: 'em-001',
    sender: 'recruiter@google.com',
    sender_name: 'Google Talent Acquisition',
    subject: 'Interview Invitation: Senior Software Engineer Position',
    message: 'Dear Candidate,\n\nWe were highly impressed with your background and would love to invite you for a technical interview round this Thursday at 2:00 PM EST. Please confirm your availability ASAP.',
    category: 'inbox',
    date: '2026-10-22 10:15',
    hour: 10,
    priority: 'High',
    notification_decision: 'Immediate',
    confidence: 0.98,
    source: 'dataset',
    is_reviewed: false,
    reason_tags: ['Urgent keyword: "interview"', 'Urgent keyword: "asap"', 'High recruiter relevance'],
    sender_score: 4,
  },
  {
    id: 'em-002',
    sender: 'dean.office@university.edu',
    sender_name: 'Academic Affairs Office',
    subject: 'URGENT: Project Submission Deadline & Final Exam Schedule',
    message: 'All students are reminded that the final project submission portal will close strictly at 23:59 tonight. No extensions will be granted without prior medical certification.',
    category: 'inbox',
    date: '2026-10-22 11:30',
    hour: 11,
    priority: 'High',
    notification_decision: 'Immediate',
    confidence: 0.97,
    source: 'dataset',
    is_reviewed: false,
    reason_tags: ['Urgent keyword: "deadline"', 'Urgent keyword: "urgent"', 'Academic priority'],
    sender_score: 3,
  },
  {
    id: 'em-003',
    sender: 'security@github.com',
    sender_name: 'GitHub Security Bot',
    subject: 'Critical Security Alert: Dependabot detected high vulnerability',
    message: 'Dependabot detected 1 high vulnerability in your repository dependencies. An automated security advisory fix is available for immediate merge.',
    category: 'inbox',
    date: '2026-10-22 09:00',
    hour: 9,
    priority: 'High',
    notification_decision: 'Immediate',
    confidence: 0.96,
    source: 'dataset',
    is_reviewed: false,
    reason_tags: ['Urgent keyword: "security alert"', 'Urgent keyword: "critical"'],
    sender_score: 2,
  },
  {
    id: 'em-004',
    sender: 'billing@stripe.com',
    sender_name: 'Stripe Billing Support',
    subject: 'Monthly Invoice #INV-2026-8819 Available for Download',
    message: 'Your monthly business subscription invoice has been processed and is ready for download in your billing dashboard.',
    category: 'inbox',
    date: '2026-10-22 14:00',
    hour: 14,
    priority: 'Medium',
    notification_decision: 'Immediate',
    confidence: 0.88,
    source: 'dataset',
    is_reviewed: false,
    reason_tags: ['Active work hours (09:00 - 18:00)', 'Business financial'],
    sender_score: 1,
  },
  {
    id: 'em-005',
    sender: 'team-sync@notion.so',
    sender_name: 'Notion Product Team',
    subject: 'Product Roadmap Review & Sprint Retrospective Meeting Notes',
    message: 'Here are the key takeaways, action items, and updated roadmap milestones from our team sync. Please review before Friday.',
    category: 'inbox',
    date: '2026-10-22 23:15',
    hour: 23,
    priority: 'Medium',
    notification_decision: 'Delayed',
    confidence: 0.84,
    source: 'dataset',
    is_reviewed: false,
    reason_tags: ['Quiet hours active (22:00 - 07:00)', 'Work correspondence'],
    sender_score: 0,
  },
  {
    id: 'em-006',
    sender: 'digest-noreply@quora.com',
    sender_name: 'Quora Digest',
    subject: 'Top Stories: What are the best software engineering practices in 2026?',
    message: 'Discover the trending questions, high-voted answers, and curated community discussions on Quora this week.',
    category: 'inbox',
    date: '2026-10-22 08:00',
    hour: 8,
    priority: 'Low',
    notification_decision: 'Suppressed',
    confidence: 0.94,
    source: 'dataset',
    is_reviewed: false,
    reason_tags: ['Low-signal keyword: "digest"', 'Automated newsletter / notification sender'],
    sender_score: -2,
  },
  {
    id: 'em-007',
    sender: 'deals@promotions.retail.com',
    sender_name: 'Mega Retail Sales',
    subject: 'EXCLUSIVE: 60% OFF electronics clearance sale ends today!',
    message: 'Don not miss our massive seasonal clearance discount. Click here to claim your limited coupon voucher before stock runs out.',
    category: 'spam',
    date: '2026-10-22 03:00',
    hour: 3,
    priority: 'Low',
    notification_decision: 'Suppressed',
    confidence: 0.99,
    source: 'dataset',
    is_reviewed: false,
    reason_tags: ['Spam classification detected', 'Low-signal keyword: "clearance sale"'],
    sender_score: -5,
  },
];

export const INITIAL_METRICS: ModelMetrics = {
  accuracy: 0.948,
  precision: 0.932,
  recall: 0.951,
  f1_score: 0.941,
  total_samples: 1000,
  updated_at: new Date().toISOString(),
};

// STORAGE HELPERS WITH SUPABASE + LOCALSTORAGE FALLBACK
const STORAGE_KEYS = {
  EMAILS: 'smart_email_items',
  RULES: 'smart_email_rules',
  SCORES: 'smart_email_sender_scores',
  SETTINGS: 'smart_email_settings',
  METRICS: 'smart_email_metrics',
};

export async function fetchEmailsFromStorage(): Promise<Email[]> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('emails')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data && data.length > 0) {
        return data as Email[];
      }
    } catch (e) {
      console.warn('Supabase fetch failed, using fallback storage:', e);
    }
  }

  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem(STORAGE_KEYS.EMAILS);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        // ignore parse error
      }
    }
  }

  return INITIAL_EMAILS;
}

export async function saveEmailsToStorage(emails: Email[]): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.EMAILS, JSON.stringify(emails));
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('emails').upsert(emails);
    } catch (e) {
      console.warn('Supabase upsert failed:', e);
    }
  }
}

export async function fetchRulesFromStorage(): Promise<BehaviorRule[]> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client.from('behavior_rules').select('*');
      if (!error && data) {
        return data as BehaviorRule[];
      }
    } catch (e) {
      console.warn('Supabase fetch rules error:', e);
    }
  }

  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem(STORAGE_KEYS.RULES);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }
  }

  return [
    { target: 'google.com', scope: 'domain', rule: 'whitelist' },
    { target: 'quora.com', scope: 'domain', rule: 'blacklist' },
  ];
}

export async function saveRuleToStorage(rule: BehaviorRule): Promise<BehaviorRule[]> {
  const rules = await fetchRulesFromStorage();
  const filtered = rules.filter(
    (r) => !(r.target.toLowerCase() === rule.target.toLowerCase() && r.scope === rule.scope)
  );
  filtered.push(rule);

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.RULES, JSON.stringify(filtered));
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('behavior_rules').upsert([rule], { onConflict: 'target,scope' });
    } catch (e) {
      console.warn('Supabase rule save error:', e);
    }
  }

  return filtered;
}

export async function deleteRuleFromStorage(target: string, scope: 'sender' | 'domain'): Promise<BehaviorRule[]> {
  const rules = await fetchRulesFromStorage();
  const updated = rules.filter(
    (r) => !(r.target.toLowerCase() === target.toLowerCase() && r.scope === scope)
  );

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.RULES, JSON.stringify(updated));
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      await client
        .from('behavior_rules')
        .delete()
        .match({ target, scope });
    } catch (e) {
      console.warn('Supabase rule delete error:', e);
    }
  }

  return updated;
}

export async function fetchSenderScores(): Promise<Record<string, number>> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client.from('sender_scores').select('*');
      if (!error && data) {
        const scores: Record<string, number> = {};
        data.forEach((row: any) => {
          scores[row.sender.toLowerCase()] = row.score;
        });
        return scores;
      }
    } catch (e) {
      console.warn('Supabase fetch sender scores error:', e);
    }
  }

  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem(STORAGE_KEYS.SCORES);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }
  }

  return {
    'recruiter@google.com': 4,
    'dean.office@university.edu': 3,
    'digest-noreply@quora.com': -2,
    'deals@promotions.retail.com': -5,
  };
}

export async function recordFeedbackInStorage(
  sender: string,
  action: 'opened' | 'ignored'
): Promise<number> {
  const senderNorm = sender.toLowerCase().trim();
  const scores = await fetchSenderScores();
  const current = scores[senderNorm] || 0;
  const delta = action === 'opened' ? 2 : -1;
  const newScore = current + delta;
  scores[senderNorm] = newScore;

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(scores));
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('sender_scores').upsert({
        sender: senderNorm,
        score: newScore,
        opened_count: action === 'opened' ? 1 : 0,
        ignored_count: action === 'ignored' ? 1 : 0,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Supabase sender score save error:', e);
    }
  }

  return newScore;
}

export async function fetchSettings(): Promise<UserSettings> {
  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }
  }
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }
  const client = getSupabaseClient();
  if (client) {
    try {
      await client.from('user_settings').upsert({
        id: 'default',
        active_hours_start: settings.active_hours_start,
        active_hours_end: settings.active_hours_end,
        quiet_hours_start: settings.quiet_hours_start,
        quiet_hours_end: settings.quiet_hours_end,
        email_source_mode: settings.email_source_mode,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Supabase settings save error:', e);
    }
  }
}
