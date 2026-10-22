import { neon } from '@neondatabase/serverless';
import { getMongoDb, isMongoDbConfigured } from './mongodb';
import { BehaviorRule, Email, UserSettings } from '@/types';
import { INITIAL_EMAILS } from './storage';
import { DEFAULT_SETTINGS } from './classifier';

// Check which cloud database is active
export const isCloudDbConfigured = (): boolean => {
  return isMongoDbConfigured() || Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
};

export const getActiveDbType = (): 'mongodb' | 'postgres' | 'memory' => {
  if (isMongoDbConfigured()) return 'mongodb';
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return 'postgres';
  return 'memory';
};

// PostgreSQL Neon lazy client
function getPgDb() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!connectionString) return null;
  return neon(connectionString);
}

// In-Memory Fallback State
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

let pgTablesInitialized = false;

async function ensurePgTables(): Promise<void> {
  if (pgTablesInitialized) return;
  const sql = getPgDb();
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
    pgTablesInitialized = true;
  } catch (e) {
    console.error('PG table init error:', e);
  }
}

// ----------------------------------------------------
// 1. EMAILS
// ----------------------------------------------------
export async function getEmails(): Promise<Email[]> {
  // Option A: MongoDB
  if (isMongoDbConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        const collection = db.collection<Email>('emails');
        const count = await collection.countDocuments();
        if (count === 0) {
          await collection.insertMany(INITIAL_EMAILS);
          return INITIAL_EMAILS;
        }
        const items = await collection.find({}).sort({ date: -1 }).toArray();
        return items.map(({ _id, ...rest }: any) => rest as Email);
      }
    } catch (err) {
      console.warn('MongoDB fetch error, fallback:', err);
    }
  }

  // Option B: PostgreSQL
  const sql = getPgDb();
  if (sql) {
    try {
      await ensurePgTables();
      const rows = await sql`SELECT * FROM emails ORDER BY created_at DESC;`;
      if (rows && rows.length > 0) {
        return rows as unknown as Email[];
      }
      return INITIAL_EMAILS;
    } catch (err) {
      console.warn('Postgres fetch error, fallback:', err);
    }
  }

  // Option C: Memory
  return inMemoryEmails;
}

export async function addOrUpdateEmail(email: Email): Promise<void> {
  // Option A: MongoDB
  if (isMongoDbConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        await db.collection('emails').updateOne(
          { id: email.id },
          { $set: email },
          { upsert: true }
        );
        return;
      }
    } catch (err) {
      console.warn('MongoDB update error:', err);
    }
  }

  // Option B: PostgreSQL
  const sql = getPgDb();
  if (sql) {
    try {
      await ensurePgTables();
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
      console.warn('Postgres update error:', err);
    }
  }

  // Option C: Memory
  const index = inMemoryEmails.findIndex((e) => e.id === email.id);
  if (index >= 0) {
    inMemoryEmails[index] = email;
  } else {
    inMemoryEmails.unshift(email);
  }
}

// ----------------------------------------------------
// 2. BEHAVIOR RULES
// ----------------------------------------------------
export async function getRules(): Promise<BehaviorRule[]> {
  // Option A: MongoDB
  if (isMongoDbConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        const collection = db.collection<BehaviorRule>('behavior_rules');
        const count = await collection.countDocuments();
        if (count === 0) {
          const defaultRules = [
            { target: 'google.com', scope: 'domain' as const, rule: 'whitelist' as const },
            { target: 'quora.com', scope: 'domain' as const, rule: 'blacklist' as const },
          ];
          await collection.insertMany(defaultRules);
          return defaultRules;
        }
        const items = await collection.find({}).toArray();
        return items.map(({ _id, ...rest }: any) => rest as BehaviorRule);
      }
    } catch (err) {
      console.warn('MongoDB rules error:', err);
    }
  }

  // Option B: PostgreSQL
  const sql = getPgDb();
  if (sql) {
    try {
      const rows = await sql`SELECT target, scope, rule FROM behavior_rules;`;
      return rows as unknown as BehaviorRule[];
    } catch (err) {}
  }

  // Option C: Memory
  return inMemoryRules;
}

export async function addRule(rule: BehaviorRule): Promise<BehaviorRule[]> {
  // Option A: MongoDB
  if (isMongoDbConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        await db.collection('behavior_rules').updateOne(
          { target: rule.target, scope: rule.scope },
          { $set: rule },
          { upsert: true }
        );
        return await getRules();
      }
    } catch (err) {
      console.warn('MongoDB add rule error:', err);
    }
  }

  // Option B: Memory
  inMemoryRules = inMemoryRules.filter(
    (r) => !(r.target.toLowerCase() === rule.target.toLowerCase() && r.scope === rule.scope)
  );
  inMemoryRules.push(rule);
  return inMemoryRules;
}

export async function deleteRule(target: string, scope: string): Promise<BehaviorRule[]> {
  // Option A: MongoDB
  if (isMongoDbConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        await db.collection('behavior_rules').deleteOne({ target, scope });
        return await getRules();
      }
    } catch (err) {}
  }

  // Option B: Memory
  inMemoryRules = inMemoryRules.filter(
    (r) => !(r.target.toLowerCase() === target.toLowerCase() && r.scope === scope)
  );
  return inMemoryRules;
}

// ----------------------------------------------------
// 3. SENDER BEHAVIOR SCORES
// ----------------------------------------------------
export async function getSenderScores(): Promise<Record<string, number>> {
  // Option A: MongoDB
  if (isMongoDbConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        const rows = await db.collection('sender_scores').find({}).toArray();
        const result: Record<string, number> = {};
        rows.forEach((r: any) => {
          result[r.sender.toLowerCase()] = r.score;
        });
        if (Object.keys(result).length > 0) return result;
      }
    } catch (err) {}
  }

  return inMemoryScores;
}

export async function updateSenderFeedback(sender: string, action: 'opened' | 'ignored'): Promise<number> {
  const normSender = sender.toLowerCase().trim();
  const currentScores = await getSenderScores();
  const current = currentScores[normSender] || 0;
  const delta = action === 'opened' ? 2 : -1;
  const newScore = current + delta;

  // Option A: MongoDB
  if (isMongoDbConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        await db.collection('sender_scores').updateOne(
          { sender: normSender },
          {
            $set: { score: newScore, updated_at: new Date() },
            $inc: {
              opened_count: action === 'opened' ? 1 : 0,
              ignored_count: action === 'ignored' ? 1 : 0,
            },
          },
          { upsert: true }
        );
        return newScore;
      }
    } catch (err) {
      console.warn('MongoDB feedback error:', err);
    }
  }

  inMemoryScores[normSender] = newScore;
  return newScore;
}

// ----------------------------------------------------
// 4. USER SETTINGS
// ----------------------------------------------------
export async function getUserSettings(): Promise<UserSettings> {
  // Option A: MongoDB
  if (isMongoDbConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        const doc = await db.collection('user_settings').findOne({ id: 'default' });
        if (doc) {
          const { _id, ...settings } = doc as any;
          return settings as UserSettings;
        }
      }
    } catch (err) {}
  }

  return inMemorySettings;
}

export async function saveUserSettings(settings: UserSettings): Promise<UserSettings> {
  // Option A: MongoDB
  if (isMongoDbConfigured()) {
    try {
      const db = await getMongoDb();
      if (db) {
        await db.collection('user_settings').updateOne(
          { id: 'default' },
          { $set: { id: 'default', ...settings, updated_at: new Date() } },
          { upsert: true }
        );
        return settings;
      }
    } catch (err) {}
  }

  inMemorySettings = { ...settings };
  return inMemorySettings;
}
