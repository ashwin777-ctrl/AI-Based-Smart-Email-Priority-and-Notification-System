import { BehaviorRule, ClassificationResult, Priority, NotificationDecision, UserSettings } from '../types';

export const BOOST_KEYWORDS = [
  'deadline',
  'urgent',
  'asap',
  'interview',
  'hiring',
  'recruiter',
  'internship',
  'job opening',
  'offer letter',
  'campus placement',
  'college',
  'university',
  'assignment',
  'exam',
  'professor',
  'coursework',
  'project submission',
  'security alert',
  'action required',
  'password reset',
  'critical',
  'payment failed',
  'invoice due',
];

export const LOW_SIGNAL_KEYWORDS = [
  'digest',
  'newsletter',
  'top stories',
  'recommended for you',
  'daily update',
  'weekly update',
  'trending',
  'quora digest',
  'subscription',
  'special offer',
  'clearance sale',
  'discount coupon',
  'unsubscribe',
  'promo',
  'sponsored',
  'webinar replay',
];

export const LOW_PRIORITY_SENDERS = [
  'quora.com',
  'digest',
  'newsletter',
  'noreply',
  'no-reply',
  'updates',
  'notification',
  'marketing',
  'promotions',
  'mailer-daemon',
];

export const DEFAULT_SETTINGS: UserSettings = {
  active_hours_start: 9,
  active_hours_end: 18,
  quiet_hours_start: 22,
  quiet_hours_end: 7,
  email_source_mode: 'dataset',
};

export function extractDomain(sender: string): string {
  const normalized = sender.trim().toLowerCase();
  const parts = normalized.split('@');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function isQuietHour(hour: number, settings: UserSettings): boolean {
  if (settings.quiet_hours_start > settings.quiet_hours_end) {
    // e.g. 22:00 to 07:00
    return hour >= settings.quiet_hours_start || hour < settings.quiet_hours_end;
  }
  return hour >= settings.quiet_hours_start && hour < settings.quiet_hours_end;
}

export function isActiveHour(hour: number, settings: UserSettings): boolean {
  return hour >= settings.active_hours_start && hour < settings.active_hours_end;
}

export function classifyEmail(
  subject: string,
  message: string,
  sender: string,
  category: string = 'inbox',
  hour?: number,
  rules: BehaviorRule[] = [],
  senderScores: Record<string, number> = {},
  settings: UserSettings = DEFAULT_SETTINGS
): ClassificationResult {
  const normSubject = (subject || '').toLowerCase();
  const normMessage = (message || '').toLowerCase();
  const normSender = (sender || '').toLowerCase().trim();
  const domain = extractDomain(normSender);
  const fullContent = `${normSubject} ${normMessage}`;

  const currentHour = hour !== undefined ? hour : new Date().getHours();
  const reasonTags: string[] = [];

  // 1. Check Explicit Whitelist / Blacklist Rules
  const senderRule = rules.find(
    (r) => r.scope === 'sender' && r.target.toLowerCase() === normSender
  );
  const domainRule = domain
    ? rules.find((r) => r.scope === 'domain' && r.target.toLowerCase() === domain)
    : undefined;

  const effectiveRule = senderRule ? senderRule.rule : domainRule ? domainRule.rule : null;

  if (effectiveRule === 'whitelist') {
    reasonTags.push(`Explicit rule: ${senderRule ? 'Sender' : 'Domain'} whitelisted`);
    return {
      priority: 'High',
      notification_decision: 'Immediate',
      confidence: 0.99,
      reason_tags: reasonTags,
      sender_score: senderScores[normSender] || 0,
    };
  }

  if (effectiveRule === 'blacklist') {
    reasonTags.push(`Explicit rule: ${senderRule ? 'Sender' : 'Domain'} blacklisted`);
    return {
      priority: 'Low',
      notification_decision: 'Suppressed',
      confidence: 0.99,
      reason_tags: reasonTags,
      sender_score: senderScores[normSender] || 0,
    };
  }

  // 2. Keyword and Category Scoring
  let score = 0;
  let matchedBoost: string[] = [];
  let matchedLowSignal: string[] = [];

  BOOST_KEYWORDS.forEach((kw) => {
    if (normSubject.includes(kw)) {
      score += 3;
      matchedBoost.push(kw);
    } else if (normMessage.includes(kw)) {
      score += 1.5;
      matchedBoost.push(kw);
    }
  });

  LOW_SIGNAL_KEYWORDS.forEach((kw) => {
    if (normSubject.includes(kw)) {
      score -= 3;
      matchedLowSignal.push(kw);
    } else if (normMessage.includes(kw)) {
      score -= 1.5;
      matchedLowSignal.push(kw);
    }
  });

  if (category.toLowerCase() === 'spam') {
    score -= 4;
    reasonTags.push('Spam classification detected');
  }

  // Check sender patterns
  const isLowSender = LOW_PRIORITY_SENDERS.some((p) => normSender.includes(p));
  if (isLowSender) {
    score -= 2;
    reasonTags.push('Automated newsletter / notification sender');
  }

  // Add keyword tags
  if (matchedBoost.length > 0) {
    const unique = Array.from(new Set(matchedBoost)).slice(0, 2);
    unique.forEach((kw) => reasonTags.push(`Urgent keyword: "${kw}"`));
  }
  if (matchedLowSignal.length > 0) {
    const unique = Array.from(new Set(matchedLowSignal)).slice(0, 2);
    unique.forEach((kw) => reasonTags.push(`Low-signal keyword: "${kw}"`));
  }

  // 3. User Behavior Sender Reputation Score Adjustment
  const userSenderScore = senderScores[normSender] || 0;
  if (userSenderScore !== 0) {
    score += userSenderScore * 0.8;
    reasonTags.push(`User engagement score: ${userSenderScore > 0 ? '+' : ''}${userSenderScore}`);
  }

  // 4. Initial Priority Assessment
  let priority: Priority = 'Medium';
  let confidence = 0.85;

  if (score >= 2.5) {
    priority = 'High';
    confidence = Math.min(0.98, 0.85 + (score - 2.5) * 0.03);
  } else if (score <= -1.5) {
    priority = 'Low';
    confidence = Math.min(0.99, 0.85 + Math.abs(score + 1.5) * 0.03);
  } else {
    priority = 'Medium';
    confidence = 0.82;
  }

  // Behavior thresholds override:
  if (userSenderScore >= 5 && priority === 'Low') {
    priority = 'Medium';
    reasonTags.push('Elevated by high user engagement history');
  } else if (userSenderScore <= -3 && priority === 'High') {
    priority = 'Medium';
    reasonTags.push('Demoted due to repeated ignored emails');
  }

  // 5. Notification Dispatch Decision Engine
  let notification_decision: NotificationDecision = 'Suppressed';

  if (priority === 'High') {
    notification_decision = 'Immediate';
    reasonTags.push('High priority: instant dispatch');
  } else if (priority === 'Medium') {
    if (isQuietHour(currentHour, settings)) {
      notification_decision = 'Delayed';
      reasonTags.push(`Quiet hours active (${settings.quiet_hours_start}:00 - ${settings.quiet_hours_end}:00)`);
    } else if (isActiveHour(currentHour, settings)) {
      notification_decision = 'Immediate';
      reasonTags.push(`Active work hours (${settings.active_hours_start}:00 - ${settings.active_hours_end}:00)`);
    } else {
      notification_decision = 'Delayed';
      reasonTags.push('Outside core active hours');
    }
  } else {
    notification_decision = 'Suppressed';
    reasonTags.push('Low priority: alert suppressed');
  }

  return {
    priority,
    notification_decision,
    confidence: Math.round(confidence * 100) / 100,
    reason_tags: reasonTags,
    sender_score: userSenderScore,
  };
}
