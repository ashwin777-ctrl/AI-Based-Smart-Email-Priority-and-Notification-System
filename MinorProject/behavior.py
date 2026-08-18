from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List


PRIORITY_ORDER = {"Low": 0, "Medium": 1, "High": 2}
ORDERED_PRIORITIES = ["Low", "Medium", "High"]
DEFAULT_BEHAVIOR_PATH = Path(__file__).resolve().parent / "data" / "behavior_profile.json"
LOW_PRIORITY_SENDERS = {
    "quora.com",
    "digest",
    "newsletter",
    "noreply",
    "no-reply",
    "updates",
    "notification",
}


@dataclass
class UserBehaviorTracker:
    sender_scores: Dict[str, int] = field(default_factory=dict)
    reviewed_emails: Dict[str, bool] = field(default_factory=dict)
    whitelisted_senders: Dict[str, bool] = field(default_factory=dict)
    blacklisted_senders: Dict[str, bool] = field(default_factory=dict)
    whitelisted_domains: Dict[str, bool] = field(default_factory=dict)
    blacklisted_domains: Dict[str, bool] = field(default_factory=dict)
    opened_emails: int = 0
    ignored_emails: int = 0
    positive_increment: int = 2
    negative_increment: int = 1
    high_score_threshold: int = 5
    low_score_threshold: int = -3
    storage_path: Path = DEFAULT_BEHAVIOR_PATH

    def __post_init__(self) -> None:
        self.storage_path = Path(self.storage_path)
        self._load()

    def update_behavior(self, sender: str, action: str) -> int:
        normalized_sender = self._normalize_sender(sender)
        normalized_action = self._normalize_action(action)

        current_score = self.sender_scores.get(normalized_sender, 0)
        if normalized_action == "opened":
            current_score += self.positive_increment
            self.opened_emails += 1
        else:
            current_score -= self.negative_increment
            self.ignored_emails += 1

        self.sender_scores[normalized_sender] = current_score
        self._save()
        return current_score

    def mark_reviewed(self, email_id: str) -> None:
        normalized_email_id = (email_id or "").strip()
        if not normalized_email_id:
            return
        self.reviewed_emails[normalized_email_id] = True
        self._save()

    def is_reviewed(self, email_id: str) -> bool:
        normalized_email_id = (email_id or "").strip()
        return bool(self.reviewed_emails.get(normalized_email_id, False))

    def set_sender_rule(self, sender: str, rule: str) -> None:
        normalized_sender = self._normalize_sender(sender)
        normalized_rule = (rule or "").strip().lower()
        if normalized_rule not in {"whitelist", "blacklist", "clear"}:
            raise ValueError("Rule must be one of: whitelist, blacklist, clear.")

        self.whitelisted_senders.pop(normalized_sender, None)
        self.blacklisted_senders.pop(normalized_sender, None)

        if normalized_rule == "whitelist":
            self.whitelisted_senders[normalized_sender] = True
        elif normalized_rule == "blacklist":
            self.blacklisted_senders[normalized_sender] = True

        self._save()

    def set_domain_rule(self, sender: str, rule: str) -> None:
        normalized_sender = self._normalize_sender(sender)
        normalized_rule = (rule or "").strip().lower()
        domain = self._extract_domain(normalized_sender)
        if not domain:
            raise ValueError("Sender does not include a valid domain.")
        if normalized_rule not in {"whitelist", "blacklist", "clear"}:
            raise ValueError("Rule must be one of: whitelist, blacklist, clear.")

        self.whitelisted_domains.pop(domain, None)
        self.blacklisted_domains.pop(domain, None)

        if normalized_rule == "whitelist":
            self.whitelisted_domains[domain] = True
        elif normalized_rule == "blacklist":
            self.blacklisted_domains[domain] = True

        self._save()

    def adjust_priority(self, priority: str, sender: str) -> str:
        normalized_priority = self._normalize_priority(priority)
        normalized_sender = self._normalize_sender(sender)
        sender_score = self.sender_scores.get(normalized_sender, 0)
        sender_domain = self._extract_domain(normalized_sender)

        if normalized_sender in self.whitelisted_senders or sender_domain in self.whitelisted_domains:
            return "High"
        if normalized_sender in self.blacklisted_senders or sender_domain in self.blacklisted_domains:
            return self._shift_priority(normalized_priority, -1)
        if any(token in normalized_sender for token in LOW_PRIORITY_SENDERS) and sender_score <= 0:
            return self._shift_priority(normalized_priority, -1)
        if sender_score >= self.high_score_threshold:
            return "High"
        if sender_score <= self.low_score_threshold:
            return self._shift_priority(normalized_priority, -1)
        return normalized_priority

    def get_sender_score(self, sender: str) -> int:
        return self.sender_scores.get(self._normalize_sender(sender), 0)

    def get_summary(self) -> Dict[str, object]:
        return {
            "opened_emails": self.opened_emails,
            "ignored_emails": self.ignored_emails,
            "sender_scores": dict(self.sender_scores),
            "reviewed_emails": dict(self.reviewed_emails),
            "whitelisted_senders": list(self.whitelisted_senders.keys()),
            "blacklisted_senders": list(self.blacklisted_senders.keys()),
            "whitelisted_domains": list(self.whitelisted_domains.keys()),
            "blacklisted_domains": list(self.blacklisted_domains.keys()),
        }

    def explain_adjustment(self, priority: str, sender: str) -> List[str]:
        normalized_priority = self._normalize_priority(priority)
        normalized_sender = self._normalize_sender(sender)
        sender_score = self.sender_scores.get(normalized_sender, 0)
        sender_domain = self._extract_domain(normalized_sender)
        reasons: List[str] = []

        if normalized_sender in self.whitelisted_senders:
            reasons.append("Sender whitelist")
        if sender_domain in self.whitelisted_domains:
            reasons.append("Domain whitelist")
        if normalized_sender in self.blacklisted_senders:
            reasons.append("Sender suppression")
        if sender_domain in self.blacklisted_domains:
            reasons.append("Domain suppression")
        if any(token in normalized_sender for token in LOW_PRIORITY_SENDERS) and sender_score <= 0:
            reasons.append("Digest/newsletter sender")
        if sender_score >= self.high_score_threshold:
            reasons.append("Positive behavior history")
        if sender_score <= self.low_score_threshold:
            reasons.append("Ignored sender history")
        if not reasons:
            reasons.append(f"Base priority: {normalized_priority}")
        return reasons

    def _load(self) -> None:
        if not self.storage_path.exists():
            return

        try:
            payload = json.loads(self.storage_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return

        self.sender_scores = {
            str(key): int(value)
            for key, value in dict(payload.get("sender_scores", {})).items()
        }
        self.reviewed_emails = {
            str(key): bool(value)
            for key, value in dict(payload.get("reviewed_emails", {})).items()
        }
        self.whitelisted_senders = {
            str(key): True for key, value in dict(payload.get("whitelisted_senders", {})).items() if value
        }
        self.blacklisted_senders = {
            str(key): True for key, value in dict(payload.get("blacklisted_senders", {})).items() if value
        }
        self.whitelisted_domains = {
            str(key): True for key, value in dict(payload.get("whitelisted_domains", {})).items() if value
        }
        self.blacklisted_domains = {
            str(key): True for key, value in dict(payload.get("blacklisted_domains", {})).items() if value
        }
        self.opened_emails = int(payload.get("opened_emails", 0))
        self.ignored_emails = int(payload.get("ignored_emails", 0))

    def _save(self) -> None:
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "sender_scores": self.sender_scores,
            "reviewed_emails": self.reviewed_emails,
            "whitelisted_senders": self.whitelisted_senders,
            "blacklisted_senders": self.blacklisted_senders,
            "whitelisted_domains": self.whitelisted_domains,
            "blacklisted_domains": self.blacklisted_domains,
            "opened_emails": self.opened_emails,
            "ignored_emails": self.ignored_emails,
        }
        self.storage_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    @staticmethod
    def _normalize_action(action: str) -> str:
        normalized_action = (action or "").strip().lower()
        if normalized_action not in {"opened", "ignored"}:
            raise ValueError("Action must be either 'opened' or 'ignored'.")
        return normalized_action

    @staticmethod
    def _normalize_sender(sender: str) -> str:
        normalized_sender = (sender or "").strip().lower()
        if not normalized_sender:
            raise ValueError("Sender cannot be empty.")
        return normalized_sender

    @staticmethod
    def _normalize_priority(priority: str) -> str:
        normalized_priority = (priority or "").strip().title()
        if normalized_priority not in PRIORITY_ORDER:
            raise ValueError("Priority must be one of: Low, Medium, High.")
        return normalized_priority

    @staticmethod
    def _shift_priority(priority: str, steps: int) -> str:
        current_index = PRIORITY_ORDER[priority]
        next_index = max(0, min(len(ORDERED_PRIORITIES) - 1, current_index + steps))
        return ORDERED_PRIORITIES[next_index]

    @staticmethod
    def _extract_domain(sender: str) -> str:
        normalized_sender = (sender or "").strip().lower()
        if "@" not in normalized_sender:
            return ""
        return normalized_sender.split("@", 1)[1]


_default_tracker = UserBehaviorTracker()


def update_behavior(sender: str, action: str) -> int:
    return _default_tracker.update_behavior(sender, action)


def adjust_priority(priority: str, sender: str) -> str:
    return _default_tracker.adjust_priority(priority, sender)


class NotificationBehaviorEngine:
    def __init__(self, tracker: UserBehaviorTracker | None = None):
        self.tracker = tracker or _default_tracker

    def analyze_email(self, email: Dict[str, str], prediction: Dict[str, object]) -> Dict[str, object]:
        sender = email.get("Sender") or email.get("sender") or email.get("Subject", "unknown")
        adjusted_priority = self.tracker.adjust_priority(str(prediction["priority"]), sender)
        sender_score = self.tracker.get_sender_score(sender)
        reasons = self.tracker.explain_adjustment(str(prediction["priority"]), sender)

        # Keep the engine focused on behavior-derived adjustments; delivery timing is handled elsewhere.
        if adjusted_priority == "High":
            decision = "Immediate"
            reason = "Sender engagement is strong or the message is already high priority."
        elif adjusted_priority == "Medium":
            decision = "Delayed"
            reason = "Useful message that can be batched into a later notification."
        else:
            decision = "Suppressed"
            reason = "Low sender engagement suggests this alert can stay quiet."

        engagement_score = max(0, min(100, 50 + (sender_score * 10)))

        return {
            "decision": decision,
            "reason": reason,
            "reason_tags": reasons,
            "engagement_score": engagement_score,
            "adjusted_priority": adjusted_priority,
            "sender_score": sender_score,
        }
