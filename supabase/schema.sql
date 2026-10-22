-- ====================================================================
-- AI-Based Smart Email Priority & Notification System Database Schema
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ====================================================================

-- 1. EMAILS TABLE
CREATE TABLE IF NOT EXISTS public.emails (
    id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    sender_name TEXT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'inbox',
    date TEXT,
    hour INT,
    priority TEXT NOT NULL CHECK (priority IN ('High', 'Medium', 'Low')),
    notification_decision TEXT NOT NULL CHECK (notification_decision IN ('Immediate', 'Delayed', 'Suppressed')),
    confidence FLOAT DEFAULT 0.85,
    source TEXT DEFAULT 'dataset',
    is_reviewed BOOLEAN DEFAULT FALSE,
    reason_tags TEXT[] DEFAULT '{}',
    sender_score INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BEHAVIOR RULES (Whitelist & Blacklist)
CREATE TABLE IF NOT EXISTS public.behavior_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('sender', 'domain')),
    rule TEXT NOT NULL CHECK (rule IN ('whitelist', 'blacklist')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(target, scope)
);

-- 3. SENDER BEHAVIOR SCORES
CREATE TABLE IF NOT EXISTS public.sender_scores (
    sender TEXT PRIMARY KEY,
    score INT DEFAULT 0,
    opened_count INT DEFAULT 0,
    ignored_count INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MODEL METRICS
CREATE TABLE IF NOT EXISTS public.model_metrics (
    id TEXT PRIMARY KEY DEFAULT 'current',
    accuracy FLOAT NOT NULL DEFAULT 0.948,
    precision FLOAT NOT NULL DEFAULT 0.932,
    recall FLOAT NOT NULL DEFAULT 0.951,
    f1_score FLOAT NOT NULL DEFAULT 0.941,
    total_samples INT DEFAULT 1000,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SYSTEM SETTINGS
CREATE TABLE IF NOT EXISTS public.user_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    active_hours_start INT DEFAULT 9,
    active_hours_end INT DEFAULT 18,
    quiet_hours_start INT DEFAULT 22,
    quiet_hours_end INT DEFAULT 7,
    email_source_mode TEXT DEFAULT 'dataset',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) & allow public anon access for web app demo
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.behavior_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sender_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Allow public read & write access with anon key
DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow anon all on emails" ON public.emails;
    CREATE POLICY "Allow anon all on emails" ON public.emails FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow anon all on behavior_rules" ON public.behavior_rules;
    CREATE POLICY "Allow anon all on behavior_rules" ON public.behavior_rules FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow anon all on sender_scores" ON public.sender_scores;
    CREATE POLICY "Allow anon all on sender_scores" ON public.sender_scores FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow anon all on model_metrics" ON public.model_metrics;
    CREATE POLICY "Allow anon all on model_metrics" ON public.model_metrics FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Allow anon all on user_settings" ON public.user_settings;
    CREATE POLICY "Allow anon all on user_settings" ON public.user_settings FOR ALL USING (true) WITH CHECK (true);
END $$;

-- 6. INITIAL SEED DATA
INSERT INTO public.model_metrics (id, accuracy, precision, recall, f1_score, total_samples)
VALUES ('current', 0.948, 0.932, 0.951, 0.941, 1000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_settings (id, active_hours_start, active_hours_end, quiet_hours_start, quiet_hours_end)
VALUES ('default', 9, 18, 22, 7)
ON CONFLICT (id) DO NOTHING;

-- Seed Sample High/Medium/Low priority emails
INSERT INTO public.emails (id, sender, sender_name, subject, message, category, date, hour, priority, notification_decision, confidence, reason_tags, sender_score)
VALUES 
('em-001', 'recruiter@google.com', 'Google Talent Team', 'Interview Invitation: Senior Software Engineer Position', 'Dear Candidate, We were highly impressed with your profile and would like to invite you for a technical interview round this Thursday. Please confirm your availability ASAP.', 'inbox', '2026-10-22 10:15', 10, 'High', 'Immediate', 0.98, ARRAY['Urgent keyword: interview', 'Urgent keyword: asap', 'High recruiter relevance'], 5),
('em-002', 'dean.office@university.edu', 'Academic Office', 'URGENT: Project Submission Deadline & Final Exam Schedule', 'Please be advised that the final project submission portal will close promptly at 23:59 tonight. No extensions will be granted without prior medical certification.', 'inbox', '2026-10-22 11:30', 11, 'High', 'Immediate', 0.96, ARRAY['Urgent keyword: deadline', 'Urgent keyword: urgent', 'Academic priority'], 4),
('em-003', 'github-notifications@github.com', 'GitHub Security', 'Critical Security Alert: Dependabot detected high vulnerability', 'Dependabot detected 1 high vulnerability in your repository. A security advisory fix is available for immediate merge.', 'inbox', '2026-10-22 09:00', 9, 'High', 'Immediate', 0.95, ARRAY['Urgent keyword: security alert', 'Whitelisted tech provider'], 3),
('em-004', 'client.services@stripe.com', 'Stripe Billing', 'Monthly Invoice #INV-2026-8819 Available', 'Your monthly account invoice has been processed and is ready for download in your dashboard.', 'inbox', '2026-10-22 14:00', 14, 'Medium', 'Immediate', 0.88, ARRAY['Active hours dispatch', 'Business financial'], 1),
('em-005', 'team-sync@notion.so', 'Notion Updates', 'Product Roadmap Review & Sprint Retrospective Meeting Notes', 'Here are the key takeaways and action items from this morning sprint planning call. Please review before Friday.', 'inbox', '2026-10-22 23:15', 23, 'Medium', 'Delayed', 0.84, ARRAY['Quiet hours active (delayed until 09:00)', 'Work correspondence'], 0),
('em-006', 'digest-noreply@quora.com', 'Quora Digest', 'Top Stories: What are the best habits of 10x engineers in 2026?', 'Discover the trending questions, answers, and curated community highlights on Quora this week.', 'inbox', '2026-10-22 08:00', 8, 'Low', 'Suppressed', 0.94, ARRAY['Low signal keyword: digest', 'Low priority sender pattern: quora.com'], -2),
('em-007', 'offers@promotions.retail.com', 'Flash Deals', 'EXCLUSIVE: 60% OFF electronics clearance sale ends today!', 'Do not miss our massive mid-season clearance sale. Click here to claim your limited discount coupon now.', 'spam', '2026-10-22 03:00', 3, 'Low', 'Suppressed', 0.99, ARRAY['Spam keyword match', 'Promotional category: spam'], -4)
ON CONFLICT (id) DO NOTHING;
