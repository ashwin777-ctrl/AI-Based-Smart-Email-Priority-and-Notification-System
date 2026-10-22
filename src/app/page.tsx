'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Inbox,
  AlertTriangle,
  Clock,
  ShieldAlert,
  Search,
  Sparkles,
  BarChart3,
  Sliders,
  CheckCircle2,
  XCircle,
  Eye,
  Database,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  Plus,
  Trash2,
  Zap,
  Info,
} from 'lucide-react';

import {
  Email,
  Priority,
  NotificationDecision,
  BehaviorRule,
  ModelMetrics,
  UserSettings,
} from '@/types';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  classifyEmail,
  DEFAULT_SETTINGS,
  extractDomain,
} from '@/lib/classifier';
import {
  fetchEmailsFromStorage,
  saveEmailsToStorage,
  fetchRulesFromStorage,
  saveRuleToStorage,
  deleteRuleFromStorage,
  fetchSenderScores,
  recordFeedbackInStorage,
  fetchSettings,
  saveSettings,
  INITIAL_METRICS,
} from '@/lib/storage';

export default function Home() {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<'inbox' | 'simulator' | 'analytics' | 'rules'>('inbox');
  const [activeFilter, setActiveFilter] = useState<'all' | 'high' | 'medium' | 'low' | 'spam'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [supabaseConnected, setSupabaseConnected] = useState(false);

  // Data State
  const [emails, setEmails] = useState<Email[]>([]);
  const [rules, setRules] = useState<BehaviorRule[]>([]);
  const [senderScores, setSenderScores] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [metrics] = useState<ModelMetrics>(INITIAL_METRICS);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);

  // Simulator Form State
  const [simSender, setSimSender] = useState('team-lead@techcorp.com');
  const [simSubject, setSimSubject] = useState('Urgent: Production server latency alert');
  const [simMessage, setSimMessage] = useState('We detected an abnormal spike in database latency affecting API response times. Action required ASAP.');
  const [simHour, setSimHour] = useState<number>(new Date().getHours());

  // Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Load initial data
  useEffect(() => {
    async function init() {
      setLoading(true);
      setSupabaseConnected(isSupabaseConfigured());
      try {
        const [loadedEmails, loadedRules, loadedScores, loadedSettings] = await Promise.all([
          fetchEmailsFromStorage(),
          fetchRulesFromStorage(),
          fetchSenderScores(),
          fetchSettings(),
        ]);
        setEmails(loadedEmails);
        setRules(loadedRules);
        setSenderScores(loadedScores);
        setSettings(loadedSettings);
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Filtered Emails Calculation
  const filteredEmails = useMemo(() => {
    return emails.filter((email) => {
      // Tab filter
      if (activeFilter === 'high' && email.priority !== 'High') return false;
      if (activeFilter === 'medium' && email.priority !== 'Medium') return false;
      if (activeFilter === 'low' && email.priority !== 'Low') return false;
      if (activeFilter === 'spam' && email.category !== 'spam') return false;

      // Search query
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        email.subject.toLowerCase().includes(q) ||
        email.sender.toLowerCase().includes(q) ||
        email.message.toLowerCase().includes(q) ||
        email.notification_decision.toLowerCase().includes(q)
      );
    });
  }, [emails, activeFilter, searchQuery]);

  // Handle User Feedback (Opened vs Ignored)
  const handleFeedback = async (email: Email, action: 'opened' | 'ignored') => {
    const newScore = await recordFeedbackInStorage(email.sender, action);
    const updatedScores = { ...senderScores, [email.sender.toLowerCase()]: newScore };
    setSenderScores(updatedScores);

    // Re-classify this email with the updated sender score
    const reclassification = classifyEmail(
      email.subject,
      email.message,
      email.sender,
      email.category,
      email.hour,
      rules,
      updatedScores,
      settings
    );

    const updatedEmails = emails.map((item) =>
      item.id === email.id
        ? {
            ...item,
            priority: reclassification.priority,
            notification_decision: reclassification.notification_decision,
            reason_tags: reclassification.reason_tags,
            sender_score: newScore,
            is_reviewed: true,
          }
        : item
    );

    setEmails(updatedEmails);
    await saveEmailsToStorage(updatedEmails);

    if (selectedEmail && selectedEmail.id === email.id) {
      setSelectedEmail({
        ...selectedEmail,
        priority: reclassification.priority,
        notification_decision: reclassification.notification_decision,
        reason_tags: reclassification.reason_tags,
        sender_score: newScore,
        is_reviewed: true,
      });
    }

    showToast(
      action === 'opened'
        ? `Marked as Opened (+2 sender score). Priority updated!`
        : `Marked as Ignored (-1 sender score). Behavior engine adapted!`
    );
  };

  // Add Whitelist / Blacklist Rule
  const handleAddRule = async (target: string, scope: 'sender' | 'domain', rule: 'whitelist' | 'blacklist') => {
    const newRule: BehaviorRule = { target, scope, rule };
    const updatedRules = await saveRuleToStorage(newRule);
    setRules(updatedRules);

    // Re-classify all emails with new rule set
    const reclassified = emails.map((item) => {
      const result = classifyEmail(
        item.subject,
        item.message,
        item.sender,
        item.category,
        item.hour,
        updatedRules,
        senderScores,
        settings
      );
      return {
        ...item,
        priority: result.priority,
        notification_decision: result.notification_decision,
        reason_tags: result.reason_tags,
      };
    });

    setEmails(reclassified);
    await saveEmailsToStorage(reclassified);

    showToast(`Rule updated: ${target} added to ${rule}. Emails re-evaluated.`);
  };

  // Remove Rule
  const handleRemoveRule = async (target: string, scope: 'sender' | 'domain') => {
    const updatedRules = await deleteRuleFromStorage(target, scope);
    setRules(updatedRules);
    showToast(`Rule removed for ${target}`);
  };

  // Simulator Live Classification
  const simulatedResult = useMemo(() => {
    return classifyEmail(
      simSubject,
      simMessage,
      simSender,
      'inbox',
      simHour,
      rules,
      senderScores,
      settings
    );
  }, [simSubject, simMessage, simSender, simHour, rules, senderScores, settings]);

  // Insert Simulated Email into Inbox
  const handleAddSimulatedEmail = async () => {
    const newEmail: Email = {
      id: `em-sim-${Date.now()}`,
      sender: simSender,
      sender_name: simSender.split('@')[0],
      subject: simSubject,
      message: simMessage,
      category: 'inbox',
      date: new Date().toISOString().replace('T', ' ').slice(0, 16),
      hour: simHour,
      priority: simulatedResult.priority,
      notification_decision: simulatedResult.notification_decision,
      confidence: simulatedResult.confidence,
      source: 'manual',
      is_reviewed: false,
      reason_tags: simulatedResult.reason_tags,
      sender_score: simulatedResult.sender_score,
    };

    const updated = [newEmail, ...emails];
    setEmails(updated);
    await saveEmailsToStorage(updated);
    showToast('Simulated email analyzed & saved to inbox!');
    setActiveTab('inbox');
    setSelectedEmail(newEmail);
  };

  // Summary counts
  const highPriorityCount = emails.filter((e) => e.priority === 'High').length;
  const mediumPriorityCount = emails.filter((e) => e.priority === 'Medium').length;
  const lowPriorityCount = emails.filter((e) => e.priority === 'Low').length;
  const immediateCount = emails.filter((e) => e.notification_decision === 'Immediate').length;

  return (
    <div className="app-container">
      {/* Top Navigation Bar */}
      <header className="navbar">
        <a href="#" className="brand">
          <div className="brand-icon">
            <Zap size={22} />
          </div>
          <div className="brand-info">
            <h1>Email Priority AI</h1>
            <span>Smart Priority & Notification Orchestration</span>
          </div>
        </a>

        <div className="nav-actions">
          {/* Supabase Status Pill */}
          <div className={`supabase-badge ${supabaseConnected ? 'connected' : 'demo'}`}>
            <span className="dot-indicator"></span>
            <Database size={14} />
            <span>{supabaseConnected ? 'Supabase Live' : 'Supabase Demo Mode'}</span>
          </div>

          <button
            className="btn-primary"
            onClick={() => setActiveTab('simulator')}
          >
            <Sparkles size={16} />
            <span>Test AI Classifier</span>
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="dashboard-grid">
        {/* Left Sidebar */}
        <aside className="sidebar">
          <div className="nav-section">
            <h3>Inbox Views</h3>
            <ul className="nav-menu">
              <li>
                <button
                  className={`nav-tab-btn ${activeTab === 'inbox' && activeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('inbox');
                    setActiveFilter('all');
                  }}
                >
                  <div className="tab-left">
                    <Inbox size={18} />
                    <span>All Emails</span>
                  </div>
                  <span className="count-pill">{emails.length}</span>
                </button>
              </li>
              <li>
                <button
                  className={`nav-tab-btn ${activeTab === 'inbox' && activeFilter === 'high' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('inbox');
                    setActiveFilter('high');
                  }}
                >
                  <div className="tab-left">
                    <AlertTriangle size={18} color="#f43f5e" />
                    <span>Urgent / High</span>
                  </div>
                  <span className="count-pill">{highPriorityCount}</span>
                </button>
              </li>
              <li>
                <button
                  className={`nav-tab-btn ${activeTab === 'inbox' && activeFilter === 'medium' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('inbox');
                    setActiveFilter('medium');
                  }}
                >
                  <div className="tab-left">
                    <Clock size={18} color="#f59e0b" />
                    <span>Actionable</span>
                  </div>
                  <span className="count-pill">{mediumPriorityCount}</span>
                </button>
              </li>
              <li>
                <button
                  className={`nav-tab-btn ${activeTab === 'inbox' && activeFilter === 'low' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('inbox');
                    setActiveFilter('low');
                  }}
                >
                  <div className="tab-left">
                    <ShieldAlert size={18} color="#64748b" />
                    <span>Low / Suppressed</span>
                  </div>
                  <span className="count-pill">{lowPriorityCount}</span>
                </button>
              </li>
            </ul>
          </div>

          <div className="nav-section">
            <h3>AI Tools</h3>
            <ul className="nav-menu">
              <li>
                <button
                  className={`nav-tab-btn ${activeTab === 'simulator' ? 'active' : ''}`}
                  onClick={() => setActiveTab('simulator')}
                >
                  <div className="tab-left">
                    <Sparkles size={18} color="#8b5cf6" />
                    <span>AI Simulator</span>
                  </div>
                </button>
              </li>
              <li>
                <button
                  className={`nav-tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
                  onClick={() => setActiveTab('analytics')}
                >
                  <div className="tab-left">
                    <BarChart3 size={18} color="#06b6d4" />
                    <span>Performance</span>
                  </div>
                </button>
              </li>
              <li>
                <button
                  className={`nav-tab-btn ${activeTab === 'rules' ? 'active' : ''}`}
                  onClick={() => setActiveTab('rules')}
                >
                  <div className="tab-left">
                    <Sliders size={18} color="#10b981" />
                    <span>Rules & Settings</span>
                  </div>
                </button>
              </li>
            </ul>
          </div>

          {/* Sidebar Overview Stats */}
          <div className="stats-box">
            <h4>
              <Zap size={15} color="#6366f1" />
              <span>Model Highlights</span>
            </h4>
            <div className="metric-row">
              <span>Classifier Accuracy</span>
              <strong>{(metrics.accuracy * 100).toFixed(1)}%</strong>
            </div>
            <div className="metric-row">
              <span>Immediate Alerts</span>
              <strong>{immediateCount}</strong>
            </div>
            <div className="metric-row">
              <span>Active Schedulers</span>
              <strong>{settings.active_hours_start}:00 - {settings.active_hours_end}:00</strong>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="main-view">
          {/* TAB 1: SMART INBOX */}
          {activeTab === 'inbox' && (
            <div>
              <div className="view-header">
                <div className="view-title">
                  <h2>Smart Priority Inbox</h2>
                  <p>Emails ranked by AI priority score, sender history, and notification timing rules.</p>
                </div>

                <div className="search-box">
                  <Search size={18} color="#64748b" />
                  <input
                    type="text"
                    placeholder="Search by subject, sender, or tag..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Filter Chips Bar */}
              <div className="filter-bar">
                <button
                  className={`filter-chip ${activeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('all')}
                >
                  All ({emails.length})
                </button>
                <button
                  className={`filter-chip ${activeFilter === 'high' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('high')}
                >
                  High Priority ({highPriorityCount})
                </button>
                <button
                  className={`filter-chip ${activeFilter === 'medium' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('medium')}
                >
                  Medium Priority ({mediumPriorityCount})
                </button>
                <button
                  className={`filter-chip ${activeFilter === 'low' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('low')}
                >
                  Low / Suppressed ({lowPriorityCount})
                </button>
              </div>

              {/* Email Cards List */}
              {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                  Loading emails from storage...
                </div>
              ) : filteredEmails.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                  <Inbox size={48} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
                  <p>No emails match the selected filter or search term.</p>
                </div>
              ) : (
                <div className="email-list">
                  {filteredEmails.map((email) => (
                    <article
                      key={email.id}
                      className={`email-card priority-${email.priority.toLowerCase()}`}
                      onClick={() => setSelectedEmail(email)}
                    >
                      <div className="card-top">
                        <div className="sender-group">
                          <div className="sender-avatar">
                            {(email.sender_name || email.sender).charAt(0).toUpperCase()}
                          </div>
                          <div className="sender-meta">
                            <strong>{email.sender_name || email.sender}</strong>
                            <span>{email.sender}</span>
                          </div>
                        </div>

                        <div className="card-badges">
                          <span className={`badge-priority ${email.priority.toLowerCase()}`}>
                            {email.priority} Priority
                          </span>
                          <span className={`badge-decision ${email.notification_decision.toLowerCase()}`}>
                            {email.notification_decision}
                          </span>
                        </div>
                      </div>

                      <h3 className="card-subject">{email.subject}</h3>
                      <p className="card-snippet">{email.message}</p>

                      <div className="card-bottom">
                        <div className="tag-list">
                          {email.reason_tags.slice(0, 3).map((tag, idx) => (
                            <span key={idx} className="reason-tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                          <span className="confidence-indicator">
                            Confidence: {Math.round(email.confidence * 100)}%
                          </span>
                          <span>{email.date}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: AI SIMULATOR / EMAIL TESTER */}
          {activeTab === 'simulator' && (
            <div>
              <div className="view-header">
                <div className="view-title">
                  <h2>AI Email Priority Simulator</h2>
                  <p>Type or paste any incoming email to see instant real-time AI classification & notification dispatching.</p>
                </div>
              </div>

              <div className="simulator-panel">
                {/* Form Input */}
                <div className="simulator-form">
                  <h3>Compose Test Email</h3>

                  <div className="form-group">
                    <label>Sender Email Address</label>
                    <input
                      type="email"
                      className="form-input"
                      value={simSender}
                      onChange={(e) => setSimSender(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Subject Line</label>
                    <input
                      type="text"
                      className="form-input"
                      value={simSubject}
                      onChange={(e) => setSimSubject(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Email Body Message</label>
                    <textarea
                      rows={5}
                      className="form-textarea"
                      value={simMessage}
                      onChange={(e) => setSimMessage(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Simulated Arrival Hour (0 - 23)</label>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <input
                        type="range"
                        min="0"
                        max="23"
                        value={simHour}
                        onChange={(e) => setSimHour(parseInt(e.target.value, 10))}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', minWidth: '4rem' }}>
                        {String(simHour).padStart(2, '0')}:00
                      </span>
                    </div>
                  </div>

                  <button className="btn-primary" onClick={handleAddSimulatedEmail}>
                    <Plus size={16} />
                    <span>Save & Add to Live Inbox</span>
                  </button>
                </div>

                {/* Live Real-time AI Output */}
                <div className="simulator-result">
                  <h3>Real-time AI Prediction</h3>

                  <div className="result-hero">
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Evaluated Priority</span>
                    <span
                      className={`badge-priority ${simulatedResult.priority.toLowerCase()}`}
                      style={{ fontSize: '1.25rem', padding: '0.4rem 1.25rem' }}
                    >
                      {simulatedResult.priority} Priority
                    </span>

                    <div style={{ marginTop: '1rem' }}>
                      <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Notification Dispatch</span>
                      <div style={{ marginTop: '0.35rem' }}>
                        <span
                          className={`badge-decision ${simulatedResult.notification_decision.toLowerCase()}`}
                          style={{ fontSize: '1rem', padding: '0.35rem 1rem' }}
                        >
                          {simulatedResult.notification_decision} Dispatch
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="decision-analysis-box">
                    <h4>
                      <Info size={16} />
                      <span>Classifier Rationale & Feature Extraction</span>
                    </h4>
                    <ul style={{ listStyle: 'disc', paddingLeft: '1.25rem', color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.6 }}>
                      {simulatedResult.reason_tags.map((tag, i) => (
                        <li key={i}>{tag}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="metric-row">
                    <span>Model Confidence:</span>
                    <strong>{Math.round(simulatedResult.confidence * 100)}%</strong>
                  </div>
                  <div className="metric-row">
                    <span>Sender Reputation Score:</span>
                    <strong>{simulatedResult.sender_score}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PERFORMANCE ANALYTICS */}
          {activeTab === 'analytics' && (
            <div>
              <div className="view-header">
                <div className="view-title">
                  <h2>Model Metrics & System Performance</h2>
                  <p>Evaluated on cross-validated benchmark email datasets and live user behavioral interactions.</p>
                </div>
              </div>

              {/* 4 Stat Cards */}
              <div className="metrics-grid">
                <div className="stat-card">
                  <span className="stat-label">Model Accuracy</span>
                  <span className="stat-value">{(metrics.accuracy * 100).toFixed(1)}%</span>
                  <span style={{ fontSize: '0.75rem', color: '#10b981' }}>+4.2% over baseline</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Precision</span>
                  <span className="stat-value">{(metrics.precision * 100).toFixed(1)}%</span>
                  <span style={{ fontSize: '0.75rem', color: '#38bdf8' }}>Low false-positive urgency</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Recall</span>
                  <span className="stat-value">{(metrics.recall * 100).toFixed(1)}%</span>
                  <span style={{ fontSize: '0.75rem', color: '#f59e0b' }}>Critical email detection</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">F1-Score</span>
                  <span className="stat-value">{metrics.f1_score.toFixed(3)}</span>
                  <span style={{ fontSize: '0.75rem', color: '#a78bfa' }}>Harmonic mean</span>
                </div>
              </div>

              {/* Visual Breakdown Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="stats-box">
                  <h4>Priority Distribution</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                        <span>High Priority</span>
                        <span>{highPriorityCount} ({emails.length ? Math.round((highPriorityCount / emails.length) * 100) : 0}%)</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.08)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ background: '#f43f5e', width: `${emails.length ? (highPriorityCount / emails.length) * 100 : 0}%`, height: '100%' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                        <span>Medium Priority</span>
                        <span>{mediumPriorityCount} ({emails.length ? Math.round((mediumPriorityCount / emails.length) * 100) : 0}%)</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.08)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ background: '#f59e0b', width: `${emails.length ? (mediumPriorityCount / emails.length) * 100 : 0}%`, height: '100%' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                        <span>Low / Suppressed</span>
                        <span>{lowPriorityCount} ({emails.length ? Math.round((lowPriorityCount / emails.length) * 100) : 0}%)</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.08)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ background: '#64748b', width: `${emails.length ? (lowPriorityCount / emails.length) * 100 : 0}%`, height: '100%' }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="stats-box">
                  <h4>Notification Decisions</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                        <span>Immediate Alerts</span>
                        <span>{immediateCount}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.08)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ background: '#10b981', width: `${emails.length ? (immediateCount / emails.length) * 100 : 0}%`, height: '100%' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                        <span>Delayed (Quiet Hours)</span>
                        <span>{emails.filter((e) => e.notification_decision === 'Delayed').length}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.08)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ background: '#f59e0b', width: `${emails.length ? (emails.filter((e) => e.notification_decision === 'Delayed').length / emails.length) * 100 : 0}%`, height: '100%' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                        <span>Suppressed</span>
                        <span>{emails.filter((e) => e.notification_decision === 'Suppressed').length}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.08)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ background: '#475569', width: `${emails.length ? (emails.filter((e) => e.notification_decision === 'Suppressed').length / emails.length) * 100 : 0}%`, height: '100%' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sender Reputation Scoreboard */}
              <div className="stats-box">
                <h4>Sender Engagement Scoreboard</h4>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1rem' }}>
                  Scores dynamically adjust priorities (+2 when opened, -1 when ignored).
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {Object.entries(senderScores).map(([sender, score]) => (
                    <div
                      key={sender}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.6rem 0.85rem',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{sender}</span>
                      <strong
                        style={{
                          color: score > 0 ? '#34d399' : score < 0 ? '#f87171' : '#94a3b8',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {score > 0 ? `+${score}` : score}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: RULES & SETTINGS */}
          {activeTab === 'rules' && (
            <div>
              <div className="view-header">
                <div className="view-title">
                  <h2>Rules & Scheduling Configuration</h2>
                  <p>Fine-tune quiet hours, active hours, and explicit whitelist/blacklist filters.</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                {/* Time Schedulers */}
                <div className="stats-box">
                  <h4>Notification Dispatch Schedules</h4>
                  <div className="form-group" style={{ marginTop: '0.5rem' }}>
                    <label>Active Work Hours ({settings.active_hours_start}:00 to {settings.active_hours_end}:00)</label>
                    <p style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      Medium-priority emails are dispatched immediately during these hours.
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="form-input"
                        value={settings.active_hours_start}
                        onChange={async (e) => {
                          const updated = { ...settings, active_hours_start: parseInt(e.target.value, 10) || 0 };
                          setSettings(updated);
                          await saveSettings(updated);
                        }}
                      />
                      <span style={{ alignSelf: 'center' }}>to</span>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="form-input"
                        value={settings.active_hours_end}
                        onChange={async (e) => {
                          const updated = { ...settings, active_hours_end: parseInt(e.target.value, 10) || 0 };
                          setSettings(updated);
                          await saveSettings(updated);
                        }}
                      />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: '1rem' }}>
                    <label>Quiet Hours ({settings.quiet_hours_start}:00 to {settings.quiet_hours_end}:00)</label>
                    <p style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      Medium priority notifications are delayed until morning. High priority alerts will still break through.
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="form-input"
                        value={settings.quiet_hours_start}
                        onChange={async (e) => {
                          const updated = { ...settings, quiet_hours_start: parseInt(e.target.value, 10) || 0 };
                          setSettings(updated);
                          await saveSettings(updated);
                        }}
                      />
                      <span style={{ alignSelf: 'center' }}>to</span>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="form-input"
                        value={settings.quiet_hours_end}
                        onChange={async (e) => {
                          const updated = { ...settings, quiet_hours_end: parseInt(e.target.value, 10) || 0 };
                          setSettings(updated);
                          await saveSettings(updated);
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Whitelist / Blacklist Rules */}
                <div className="stats-box">
                  <h4>Active Behavioral Rules</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '0.5rem' }}>
                    {rules.map((rule, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.6rem 0.85rem',
                          background: 'rgba(255,255,255,0.03)',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: '0.85rem' }}>{rule.target}</strong>
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block' }}>
                            Scope: {rule.scope} • Policy: {rule.rule.toUpperCase()}
                          </span>
                        </div>
                        <button
                          className="btn-secondary"
                          style={{ padding: '0.35rem 0.65rem' }}
                          onClick={() => handleRemoveRule(rule.target, rule.scope)}
                        >
                          <Trash2 size={14} color="#f87171" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
                    <h5 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Supabase Cloud Connection</h5>
                    <p style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.5 }}>
                      To persist live data to your cloud Supabase database, add your credentials to <code>.env.local</code>:
                    </p>
                    <pre
                      style={{
                        marginTop: '0.5rem',
                        padding: '0.6rem',
                        background: 'rgba(0,0,0,0.4)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.75rem',
                        color: '#34d399',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      NEXT_PUBLIC_SUPABASE_URL=...{'\n'}
                      NEXT_PUBLIC_SUPABASE_ANON_KEY=...
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* DETAIL INSPECTOR MODAL */}
      {selectedEmail && (
        <div className="modal-overlay" onClick={() => setSelectedEmail(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span className={`badge-priority ${selectedEmail.priority.toLowerCase()}`}>
                    {selectedEmail.priority} Priority
                  </span>
                  <span className={`badge-decision ${selectedEmail.notification_decision.toLowerCase()}`}>
                    {selectedEmail.notification_decision} Dispatch
                  </span>
                </div>
                <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>{selectedEmail.subject}</h3>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  From: {selectedEmail.sender_name || selectedEmail.sender} &lt;{selectedEmail.sender}&gt; • {selectedEmail.date}
                </span>
              </div>
              <button className="modal-close-btn" onClick={() => setSelectedEmail(null)}>
                <XCircle size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div className="decision-analysis-box">
                <h4>
                  <Zap size={16} />
                  <span>AI Decision Rationale</span>
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  {selectedEmail.reason_tags.map((tag, idx) => (
                    <span key={idx} className="reason-tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                  Confidence score: <strong>{Math.round(selectedEmail.confidence * 100)}%</strong> • Sender reputation:{' '}
                  <strong>{senderScores[selectedEmail.sender.toLowerCase()] || selectedEmail.sender_score || 0}</strong>
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.4rem' }}>Message Body</h4>
                <div className="email-full-message">{selectedEmail.message}</div>
              </div>
            </div>

            <div className="modal-actions">
              <div className="action-group">
                <button
                  className="btn-primary"
                  onClick={() => handleFeedback(selectedEmail, 'opened')}
                >
                  <CheckCircle2 size={16} />
                  <span>Mark as Opened (+2)</span>
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleFeedback(selectedEmail, 'ignored')}
                >
                  <Eye size={16} />
                  <span>Mark as Ignored (-1)</span>
                </button>
              </div>

              <div className="action-group">
                <button
                  className="btn-secondary"
                  onClick={() => handleAddRule(selectedEmail.sender, 'sender', 'whitelist')}
                >
                  <span>Whitelist Sender</span>
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleAddRule(extractDomain(selectedEmail.sender), 'domain', 'blacklist')}
                >
                  <span>Blacklist Domain</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION CONTAINER */}
      {toastMessage && (
        <div className="toast-container">
          <div className="toast">
            <CheckCircle2 size={16} color="#10b981" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}
