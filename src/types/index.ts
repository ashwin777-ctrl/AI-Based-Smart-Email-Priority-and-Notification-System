export type Priority = 'High' | 'Medium' | 'Low';
export type NotificationDecision = 'Immediate' | 'Delayed' | 'Suppressed';

export interface Email {
  id: string;
  sender: string;
  sender_name?: string;
  subject: string;
  message: string;
  category: 'inbox' | 'spam' | 'promotions' | string;
  date: string;
  hour?: number;
  priority: Priority;
  notification_decision: NotificationDecision;
  confidence: number;
  source: 'dataset' | 'mailbox' | 'manual';
  is_reviewed?: boolean;
  reason_tags: string[];
  sender_score?: number;
}

export interface BehaviorRule {
  id?: string;
  target: string;
  scope: 'sender' | 'domain';
  rule: 'whitelist' | 'blacklist';
  created_at?: string;
}

export interface SenderScore {
  sender: string;
  score: number;
  opened_count: number;
  ignored_count: number;
  updated_at?: string;
}

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1_score: number;
  total_samples: number;
  updated_at?: string;
}

export interface UserSettings {
  active_hours_start: number;
  active_hours_end: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  email_source_mode: 'dataset' | 'mailbox';
}

export interface ClassificationResult {
  priority: Priority;
  notification_decision: NotificationDecision;
  confidence: number;
  reason_tags: string[];
  sender_score: number;
}
