import { neon, neonConfig } from '@neondatabase/serverless';
import { BehaviorRule, Email, ModelMetrics, UserSettings } from '@/types';
import { INITIAL_EMAILS, INITIAL_METRICS } from './storage';
import { DEFAULT_SETTINGS } from './classifier';

// Check if Neon or standard PostgreSQL DATABASE_URL is configured
export const isCloudDbConfigured = (): boolean => {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  return Boolean(dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')));
};

// Lazy Neon client getter
function getDb() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!connectionString) return null;
  return neon(connectionString);
}

// In-Memory Fallback State (when no external DB is plugged in)
let inMemoryEmails: Email[] = [...INITIAL_EMAILS];
let inMemoryRules: BehaviorRule[] = [
  { target: 'google.com', scope: 'domain', rule: 'whitelist' },
  { target: 'quora.com', scope: 'domain', rule: 'blacklist' },
];
let inMemoryScores: Record<string, number> = {
  'recruiter@google.com': 4,
  'dean.office@university.edu': 3,
  'digest-noreply@quora.com': -2,
  'deals@promotions.retail.com': -5,
};
let inMemorySettings: UserSettings = { ...DEFAULT_SETTINGS };

let tablesInitialized = false;

// Auto-provision tables if using PostgreSQL
export async function ensureTablesExist(): Promise<void> {
  if (tablesInitialized) return;
  const sql = getDb();
  if (!sql) return;

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS emails (
        id TEXT PRIMARY KEY,
        sender TEXT NOT NULL,
        sender_name TEXT,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        category TEXT DEFAULT 'inbox',
        date TEXT,
        hour INT,
        priority TEXT NOT NULL,
        notification_decision TEXT NOT NULL,
        confidence FLOAT DEFAULT 0.85,
        source TEXT DEFAULT 'dataset',
        is_reviewed BOOLEAN DEFAULT FALSE,
        reason_tags TEXT[] DEFAULT '{}',
        sender_score INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS behavior_rules (
        id SERIAL PRIMARY KEY,
        target TEXT NOT NULL,
        scope TEXT NOT NULL,
        rule TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(target, scope)
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS sender_scores (
        sender TEXT PRIMARY KEY,
        score INT DEFAULT 0,
        opened_count INT DEFAULT 0,
        ignored_count INT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS user_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        active_hours_start INT DEFAULT 9,
        active_hours_end INT DEFAULT 18,
        quiet_hours_start INT DEFAULT 22,
        quiet_hours_end INT DEFAULT 7,
        email_source_mode TEXT DEFAULT 'dataset',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    tablesInitialized = true;
  } catch (err) {
    console.error('Error auto-creating database tables:', err);
  }
}

// 1. EMAILS
export async function getEmails(): Promise<Email[]> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureTablesExist();
      const rows = await sql`SELECT * FROM emails ORDER BY created_at DESC;`;
      if (rows && rows.length > 0) {
        return rows as unknown as Email[];
      }
      // If table is empty, seed initial dataset
      for (const e of INITIAL_EMAILS) {
        await sql`
          INSERT INTO emails (id, sender, sender_name, subject, message, category, date, hour, priority, notification_decision, confidence, reason_tags, sender_score)
          VALUES (${e.id}, ${e.sender}, ${e.sender_name || ''}, ${e.subject}, ${e.message}, ${e.category}, ${e.date}, ${e.hour || 12}, ${e.priority}, ${e.notification_decision}, ${e.confidence}, ${e.reason_tags}, ${e.sender_score || 0})
          ON CONFLICT (id) DO NOTHING;
        `;
      }
      return INITIAL_EMAILS;
    } catch (err) {
      console.warn('DB query error, fallback to memory:', err);
    }
  }
  return inMemoryEmails;
}

export async function addOrUpdateEmail(email: Email): Promise<void> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureTablesExist();
      await sql`
        INSERT INTO emails (id, sender, sender_name, subject, message, category, date, hour, priority, notification_decision, confidence, reason_tags, sender_score, is_reviewed)
        VALUES (${email.id}, ${email.sender}, ${email.sender_name || ''}, ${email.subject}, ${email.message}, ${email.category}, ${email.date}, ${email.hour || 12}, ${email.priority}, ${email.notification_decision}, ${email.confidence}, ${email.reason_tags}, ${email.sender_score || 0}, ${email.is_reviewed || false})
        ON CONFLICT (id) DO UPDATE SET
          priority = EXCLUDED.priority,
          notification_decision = EXCLUDED.notification_decision,
          reason_tags = EXCLUDED.reason_tags,
          sender_score = EXCLUDED.sender_score,
          is_reviewed = EXCLUDED.is_reviewed;
      `;
      return;
    } catch (err) {
      console.warn('DB upsert error, saving to memory:', err);
    }
  }

  const index = inMemoryEmails.findIndex((e) => e.id === email.id);
  if (index >= 0) {
    inMemoryEmails[index] = email;
  } else {
    inMemoryEmails.unshift(email);
  }
}

// 2. BEHAVIOR RULES
export async function getRules(): Promise<BehaviorRule[]> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureTablesExist();
      const rows = await sql`SELECT target, scope, rule FROM behavior_rules;`;
      return rows as unknown as BehaviorRule[];
    } catch (err) {
      console.warn('DB rules error:', err);
    }
  }
  return inMemoryRules;
}

export async function addRule(rule: BehaviorRule): Promise<BehaviorRule[]> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureTablesExist();
      await sql`
        INSERT INTO behavior_rules (target, scope, rule)
        VALUES (${rule.target}, ${rule.scope}, ${rule.rule})
        ON CONFLICT (target, scope) DO UPDATE SET rule = EXCLUDED.rule;
      `;
      return await getRules();
    } catch (err) {
      console.warn('DB rule save error:', err);
    }
  }

  inMemoryRules = inMemoryRules.filter(
    (r) => !(r.target.toLowerCase() === rule.target.toLowerCase() && r.scope === rule.scope)
  );
  inMemoryRules.push(rule);
  return inMemoryRules;
}

export async function deleteRule(target: string, scope: string): Promise<BehaviorRule[]> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureTablesExist();
      await sql`DELETE FROM behavior_rules WHERE target = ${target} AND scope = ${scope};`;
      return await getRules();
    } catch (err) {
      console.warn('DB rule delete error:', err);
    }
  }

  inMemoryRules = inMemoryRules.filter(
    (r) => !(r.target.toLowerCase() === target.toLowerCase() && r.scope === scope)
  );
  return inMemoryRules;
}

// 3. SENDER BEHAVIOR FEEDBACK
export async function getSenderScores(): Promise<Record<string, number>> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureTablesExist();
      const rows = await sql`SELECT sender, score FROM sender_scores;`;
      const result: Record<string, number> = {};
      rows.forEach((r: any) => {
        result[r.sender.toLowerCase()] = r.score;
      });
      return result;
    } catch (err) {
      console.warn('DB sender scores error:', err);
    }
  }
  return inMemoryScores;
}

export async function updateSenderFeedback(sender: string, action: 'opened' | 'ignored'): Promise<number> {
  const normSender = sender.toLowerCase().trim();
  const currentScores = await getSenderScores();
  const current = currentScores[normSender] || 0;
  const delta = action === 'opened' ? 2 : -1;
  const newScore = current + delta;

  const sql = getDb();
  if (sql) {
    try {
      await ensureTablesExist();
      await sql`
        INSERT INTO sender_scores (sender, score, opened_count, ignored_count, updated_at)
        VALUES (
          ${normSender},
          ${newScore},
          ${action === 'opened' ? 1 : 0},
          ${action === 'ignored' ? 1 : 0},
          NOW()
        )
        ON CONFLICT (sender) DO UPDATE SET
          score = ${newScore},
          opened_count = sender_scores.opened_count + ${action === 'opened' ? 1 : 0},
          ignored_count = sender_scores.ignored_count + ${action === 'ignored' ? 1 : 0},
          updated_at = NOW();
      `;
      return newScore;
    } catch (err) {
      console.warn('DB feedback update error:', err);
    }
  }

  inMemoryScores[normSender] = newScore;
  return newScore;
}

// 4. USER SETTINGS
export async function getUserSettings(): Promise<UserSettings> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureTablesExist();
      const rows = await sql`SELECT active_hours_start, active_hours_end, quiet_hours_start, quiet_hours_end, email_source_mode FROM user_settings WHERE id = 'default';`;
      if (rows && rows.length > 0) {
        return rows[0] as unknown as UserSettings;
      }
    } catch (err) {
      console.warn('DB settings error:', err);
    }
  }
  return inMemorySettings;
}

export async function saveUserSettings(settings: UserSettings): Promise<UserSettings> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureTablesExist();
      await sql`
        INSERT INTO user_settings (id, active_hours_start, active_hours_end, quiet_hours_start, quiet_hours_end, email_source_mode, updated_at)
        VALUES ('default', ${settings.active_hours_start}, ${settings.active_hours_end}, ${settings.quiet_hours_start}, ${settings.quiet_hours_end}, ${settings.email_source_mode}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          active_hours_start = EXCLUDED.active_hours_start,
          active_hours_end = EXCLUDED.active_hours_end,
          quiet_hours_start = EXCLUDED.quiet_hours_start,
          quiet_hours_end = EXCLUDED.quiet_hours_end,
          email_source_mode = EXCLUDED.email_source_mode,
          updated_at = NOW();
      `;
      return settings;
    } catch (err) {
      console.warn('DB settings save error:', err);
    }
  }
  inMemorySettings = { ...settings };
  return inMemorySettings;
}
