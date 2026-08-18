from __future__ import annotations

import email
import html
import imaplib
import logging
import secrets
import re
from dataclasses import dataclass, field
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd
from flask import Flask, jsonify, redirect, render_template, request, session, url_for

from behavior import NotificationBehaviorEngine
from ml_model import DEFAULT_DATASET_PATH, DEFAULT_FAST_MODE, FAST_MODE_SAMPLE_SIZE, EmailPriorityModel


logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATASET_PATH = DEFAULT_DATASET_PATH
MAILBOX_SESSION_KEY = "mailbox_session_id"
MAILBOX_SOURCE_KEY = "email_source_mode"
DEFAULT_MAIL_FETCH_LIMIT = 40


@dataclass(frozen=True)
class AppConfig:
    dataset_path: Path = DATASET_PATH
    active_hours: set[int] = field(default_factory=lambda: {9, 18})
    quiet_hours: set[int] = field(default_factory=lambda: {0, 1, 2, 3, 4, 5, 6, 22, 23})
    fast_mode: bool = DEFAULT_FAST_MODE
    sample_size: int = FAST_MODE_SAMPLE_SIZE
    mailbox_limit: int = DEFAULT_MAIL_FETCH_LIMIT
    dataset_display_limit: int = 1000


@dataclass
class MailboxCredentials:
    email_address: str
    password: str
    imap_host: str
    imap_port: int = 993


class MailboxSessionStore:
    def __init__(self) -> None:
        self._sessions: Dict[str, MailboxCredentials] = {}

    def create(self, credentials: MailboxCredentials) -> str:
        session_id = secrets.token_urlsafe(32)
        self._sessions[session_id] = credentials
        return session_id

    def get(self, session_id: Optional[str]) -> Optional[MailboxCredentials]:
        if not session_id:
            return None
        return self._sessions.get(session_id)

    def delete(self, session_id: Optional[str]) -> None:
        if session_id:
            self._sessions.pop(session_id, None)


class MailboxConnectionError(RuntimeError):
    pass


def _success_response(**payload: object):
    return jsonify({"status": "success", **payload})


def _error_response(message: str, status_code: int = 400):
    return jsonify({"status": "error", "message": message}), status_code


def _decode_header_value(value: object) -> str:
    if not value:
        return ""

    try:
        return str(make_header(decode_header(str(value))))
    except Exception:
        return str(value)


def _extract_plain_text(message: Message) -> str:
    html_fallback = ""

    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition") or "").lower()
            if "attachment" in disposition:
                continue

            if content_type == "text/plain":
                payload = part.get_payload(decode=True) or b""
                charset = part.get_content_charset() or "utf-8"
                try:
                    return payload.decode(charset, errors="replace").strip()
                except LookupError:
                    return payload.decode("utf-8", errors="replace").strip()

            if content_type == "text/html" and not html_fallback:
                payload = part.get_payload(decode=True) or b""
                charset = part.get_content_charset() or "utf-8"
                try:
                    html_fallback = payload.decode(charset, errors="replace").strip()
                except LookupError:
                    html_fallback = payload.decode("utf-8", errors="replace").strip()

        return _html_to_text(html_fallback)

    payload = message.get_payload(decode=True) or b""
    charset = message.get_content_charset() or "utf-8"
    try:
        decoded_payload = payload.decode(charset, errors="replace").strip()
    except LookupError:
        decoded_payload = payload.decode("utf-8", errors="replace").strip()

    if message.get_content_type() == "text/html":
        return _html_to_text(decoded_payload)
    return decoded_payload


def _html_to_text(raw_html: str) -> str:
    if not raw_html:
        return ""

    cleaned = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", raw_html)
    cleaned = re.sub(r"(?i)<br\s*/?>", "\n", cleaned)
    cleaned = re.sub(r"(?i)</p\s*>", "\n\n", cleaned)
    cleaned = re.sub(r"(?i)</div\s*>", "\n", cleaned)
    cleaned = re.sub(r"(?is)<[^>]+>", " ", cleaned)
    cleaned = html.unescape(cleaned)
    cleaned = cleaned.replace("\xa0", " ")
    cleaned = re.sub(r"\n\s*\n\s*\n+", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r" *\n *", "\n", cleaned)
    return cleaned.strip()


def _normalize_date_header(raw_date: str) -> str:
    try:
        return parsedate_to_datetime(raw_date).isoformat(sep=" ")
    except Exception:
        return raw_date or ""


def _resolve_imap_host(email_address: str, imap_host: str = "") -> str:
    normalized_host = (imap_host or "").strip()
    if normalized_host:
        return normalized_host

    domain = email_address.split("@")[-1].lower() if "@" in email_address else ""
    known_hosts = {
        "gmail.com": "imap.gmail.com",
        "googlemail.com": "imap.gmail.com",
        "outlook.com": "outlook.office365.com",
        "hotmail.com": "outlook.office365.com",
        "live.com": "outlook.office365.com",
        "office365.com": "outlook.office365.com",
        "yahoo.com": "imap.mail.yahoo.com",
        "yahoo.co.in": "imap.mail.yahoo.com",
        "icloud.com": "imap.mail.me.com",
        "me.com": "imap.mail.me.com",
    }

    if domain in known_hosts:
        return known_hosts[domain]
    raise MailboxConnectionError(
        "Could not infer the IMAP host for this email provider. Please enter the IMAP host manually."
    )


class MailboxClient:
    def __init__(self, credentials: MailboxCredentials, fetch_limit: int = DEFAULT_MAIL_FETCH_LIMIT) -> None:
        self.credentials = credentials
        self.fetch_limit = fetch_limit

    def test_connection(self) -> None:
        with self._connect() as mailbox:
            status, _ = mailbox.select("INBOX", readonly=True)
            if status != "OK":
                raise MailboxConnectionError("Connected, but the INBOX folder could not be opened.")

    def fetch_recent_emails(self) -> List[Dict[str, object]]:
        with self._connect() as mailbox:
            status, _ = mailbox.select("INBOX", readonly=True)
            if status != "OK":
                raise MailboxConnectionError("Could not open the inbox folder.")

            status, data = mailbox.search(None, "ALL")
            if status != "OK":
                raise MailboxConnectionError("Could not list emails from the inbox.")

            ids = data[0].split()[-self.fetch_limit :]
            live_emails: List[Dict[str, object]] = []

            for raw_id in reversed(ids):
                status, payload = mailbox.fetch(raw_id, "(RFC822)")
                if status != "OK" or not payload:
                    continue

                raw_message = payload[0][1] if isinstance(payload[0], tuple) else None
                if not raw_message:
                    continue

                parsed_message = email.message_from_bytes(raw_message)
                sender_name, sender_email = parseaddr(_decode_header_value(parsed_message.get("From")))
                subject = _decode_header_value(parsed_message.get("Subject"))
                body = _extract_plain_text(parsed_message)
                normalized_date = _normalize_date_header(_decode_header_value(parsed_message.get("Date")))

                live_emails.append(
                    {
                        "id": raw_id.decode("utf-8", errors="ignore"),
                        "Subject": subject,
                        "Message": body[:4000],
                        "Spam/Ham": "ham",
                        "Date": normalized_date,
                        "sender": sender_email.lower() or sender_name.lower() or "unknown",
                        "sender_name": sender_name or sender_email or "unknown",
                        "source": "mailbox",
                        "category": "inbox",
                    }
                )

            return live_emails

    def _connect(self) -> imaplib.IMAP4_SSL:
        try:
            mailbox = imaplib.IMAP4_SSL(self.credentials.imap_host, self.credentials.imap_port)
            mailbox.login(self.credentials.email_address, self.credentials.password)
            return mailbox
        except imaplib.IMAP4.error as exc:
            raise MailboxConnectionError(
                "Mailbox login failed. If you use Gmail or Outlook, use an app password and make sure IMAP is enabled."
            ) from exc
        except OSError as exc:
            raise MailboxConnectionError(
                "Unable to reach the mail server. Please check the IMAP host, internet connection, and firewall settings."
            ) from exc


class EmailNotificationService:
    def __init__(
        self,
        priority_model: EmailPriorityModel,
        behavior_engine: NotificationBehaviorEngine,
        active_hours: set[int],
        quiet_hours: set[int],
        dataset_display_limit: int,
    ) -> None:
        self.priority_model = priority_model
        self.behavior_engine = behavior_engine
        self.active_hours = active_hours
        self.quiet_hours = quiet_hours
        self.dataset_display_limit = dataset_display_limit

    @staticmethod
    def extract_sender(raw_email: Dict[str, object]) -> str:
        sender = str(raw_email.get("sender") or raw_email.get("Sender") or "").strip().lower()
        return sender or "unknown"

    @staticmethod
    def extract_email_hour(date_value: object, fallback_hour: object = None) -> int | None:
        if fallback_hour is not None and not pd.isna(fallback_hour):
            return int(fallback_hour)

        parsed_date = pd.to_datetime(date_value, errors="coerce")
        if pd.isna(parsed_date):
            return None
        return int(parsed_date.hour)

    def assign_notification(self, priority: str, hour: int | None) -> str:
        if priority == "High":
            return "Immediate"
        if priority == "Medium":
            if hour in self.quiet_hours:
                return "Delayed"
            return "Immediate" if hour in self.active_hours else "Delayed"
        return "Suppressed"

    @staticmethod
    def build_email_id(raw_email: Dict[str, object]) -> str:
        explicit_id = str(raw_email.get("id") or "").strip()
        if explicit_id:
            return explicit_id
        sender = str(raw_email.get("sender") or raw_email.get("Sender") or "unknown").strip().lower()
        subject = str(raw_email.get("Subject") or "").strip().lower()
        date_value = str(raw_email.get("Date") or "").strip()
        return f"{sender}|{subject}|{date_value}"

    def build_email_payload(self, raw_email: Dict[str, object]) -> Dict[str, object]:
        subject = str(raw_email.get("Subject") or "")
        message = str(raw_email.get("Message") or "")
        category = str(raw_email.get("Spam/Ham") or raw_email.get("category") or "inbox")
        date_value = raw_email.get("Date", "")
        hour = self.extract_email_hour(date_value, raw_email.get("hour"))

        sender = self.extract_sender(raw_email)
        prediction = self.priority_model.predict_email(subject, message, category, str(date_value))
        behavior = self.behavior_engine.analyze_email({**raw_email, "Sender": sender}, prediction)
        adjusted_priority = behavior["adjusted_priority"]
        notification = self.assign_notification(adjusted_priority, hour)
        email_id = self.build_email_id(raw_email)
        reason_tags = list(behavior.get("reason_tags", []))
        if hour in self.quiet_hours and adjusted_priority == "Medium":
            reason_tags.append("Quiet hours")
        if hour in self.active_hours and adjusted_priority == "Medium" and hour not in self.quiet_hours:
            reason_tags.append("Active hours")

        return {
            "id": email_id,
            "subject": subject,
            "message": message,
            "sender": sender,
            "sender_name": str(raw_email.get("sender_name") or sender),
            "priority": adjusted_priority,
            "notification": notification,
            "notification_decision": notification,
            "category": category.lower(),
            "date": str(date_value or ""),
            "confidence": prediction.get("confidence", 0.0),
            "source": str(raw_email.get("source") or "dataset"),
            "reviewed": self.behavior_engine.tracker.is_reviewed(email_id),
            "reason_tags": reason_tags,
            "sender_score": behavior.get("sender_score", 0),
        }

    def list_dataset_emails(self) -> List[Dict[str, object]]:
        emails = self.priority_model.get_emails(limit=self.dataset_display_limit)
        return [self.build_email_payload(email) for email in emails]

    def list_mailbox_emails(self, mailbox_client: MailboxClient) -> List[Dict[str, object]]:
        emails = mailbox_client.fetch_recent_emails()
        return [self.build_email_payload(email) for email in emails]

    def record_feedback(self, sender: str, action: str) -> int:
        return self.behavior_engine.tracker.update_behavior(sender, action)

    def mark_reviewed(self, email_id: str) -> None:
        self.behavior_engine.tracker.mark_reviewed(email_id)

    def set_rule(self, sender: str, scope: str, rule: str) -> None:
        normalized_scope = (scope or "").strip().lower()
        if normalized_scope == "sender":
            self.behavior_engine.tracker.set_sender_rule(sender, rule)
            return
        if normalized_scope == "domain":
            self.behavior_engine.tracker.set_domain_rule(sender, rule)
            return
        raise ValueError("Scope must be either 'sender' or 'domain'.")


def create_app(config: AppConfig | None = None) -> Flask:
    app_config = config or AppConfig()
    app = Flask(__name__)
    app.secret_key = secrets.token_hex(32)

    priority_model = EmailPriorityModel(app_config.dataset_path)
    priority_model.fast_mode = app_config.fast_mode
    priority_model.sample_size = app_config.sample_size
    if priority_model.model is None and priority_model.dataset_path.exists():
        priority_model.train()
    behavior_engine = NotificationBehaviorEngine()
    mailbox_store = MailboxSessionStore()
    notification_service = EmailNotificationService(
        priority_model=priority_model,
        behavior_engine=behavior_engine,
        active_hours=app_config.active_hours,
        quiet_hours=app_config.quiet_hours,
        dataset_display_limit=app_config.dataset_display_limit,
    )

    def current_mailbox_credentials() -> Optional[MailboxCredentials]:
        return mailbox_store.get(session.get(MAILBOX_SESSION_KEY))

    def current_mailbox_client() -> Optional[MailboxClient]:
        credentials = current_mailbox_credentials()
        if credentials is None:
            return None
        return MailboxClient(credentials, fetch_limit=app_config.mailbox_limit)

    def current_source_mode() -> str:
        source_mode = str(session.get(MAILBOX_SOURCE_KEY) or "dataset").lower()
        if source_mode not in {"dataset", "mailbox"}:
            return "dataset"
        return source_mode

    @app.route("/")
    def index():
        credentials = current_mailbox_credentials()
        return render_template(
            "index.html",
            mailbox_connected=credentials is not None,
            mailbox_email=credentials.email_address if credentials else "",
            source_mode=current_source_mode(),
        )

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "GET":
            credentials = current_mailbox_credentials()
            return render_template(
                "login.html",
                error="",
                mailbox_connected=credentials is not None,
                mailbox_email=credentials.email_address if credentials else "",
            )

        email_address = str(request.form.get("email") or "").strip()
        password = str(request.form.get("password") or "").strip()
        imap_host = str(request.form.get("imap_host") or "").strip()

        if not email_address or not password:
            return render_template(
                "login.html",
                error="Please enter both email and password.",
                mailbox_connected=False,
                mailbox_email="",
            )

        try:
            resolved_imap_host = _resolve_imap_host(email_address, imap_host)
            credentials = MailboxCredentials(
                email_address=email_address,
                password=password,
                imap_host=resolved_imap_host,
            )
            MailboxClient(credentials, fetch_limit=app_config.mailbox_limit).test_connection()
        except MailboxConnectionError as exc:
            return render_template(
                "login.html",
                error=str(exc),
                mailbox_connected=False,
                mailbox_email="",
            )

        existing_session_id = session.get(MAILBOX_SESSION_KEY)
        mailbox_store.delete(existing_session_id)
        session[MAILBOX_SESSION_KEY] = mailbox_store.create(credentials)
        session[MAILBOX_SOURCE_KEY] = "mailbox"
        return redirect(url_for("index"))

    @app.route("/source", methods=["POST"])
    def set_source():
        requested_source = str(request.form.get("source") or "").strip().lower()
        if requested_source not in {"dataset", "mailbox"}:
            return redirect(url_for("index"))

        if requested_source == "mailbox" and current_mailbox_credentials() is None:
            session[MAILBOX_SOURCE_KEY] = "dataset"
            return redirect(url_for("login"))

        session[MAILBOX_SOURCE_KEY] = requested_source
        return redirect(url_for("index"))

    @app.route("/logout", methods=["POST"])
    def logout():
        mailbox_store.delete(session.get(MAILBOX_SESSION_KEY))
        session.pop(MAILBOX_SESSION_KEY, None)
        session[MAILBOX_SOURCE_KEY] = "dataset"
        return redirect(url_for("login"))

    @app.route("/emails")
    @app.route("/api/emails")
    def get_emails():
        try:
            mailbox_client = current_mailbox_client()
            if mailbox_client is not None and current_source_mode() == "mailbox":
                emails = notification_service.list_mailbox_emails(mailbox_client)
                return _success_response(
                    count=len(emails),
                    emails=emails,
                    model_metrics=priority_model.metrics,
                    source="mailbox",
                    mailbox_connected=True,
                )

            emails = notification_service.list_dataset_emails()
            return _success_response(
                count=len(emails),
                emails=emails,
                model_metrics=priority_model.metrics,
                source="dataset",
                mailbox_connected=False,
            )
        except (FileNotFoundError, ValueError, MailboxConnectionError) as exc:
            LOGGER.warning("Email loading issue: %s", exc)
            return _error_response(str(exc), 400)
        except Exception as exc:  # pragma: no cover
            LOGGER.exception("Failed to load emails.")
            return _error_response(f"Unable to load emails: {exc}", 500)

    @app.route("/feedback", methods=["POST"])
    @app.route("/api/feedback", methods=["POST"])
    def feedback():
        payload = request.get_json(silent=True) or {}
        sender = str(payload.get("sender") or "").strip()
        action = str(payload.get("action") or "").strip().lower()

        if not sender:
            return _error_response("Payload must include a sender.")

        try:
            sender_score = notification_service.record_feedback(sender, action)
        except ValueError as exc:
            return _error_response(str(exc))
        except Exception as exc:  # pragma: no cover
            LOGGER.exception("Failed to record feedback.")
            return _error_response(f"Unable to record feedback: {exc}", 500)

        return _success_response(
            message="Feedback recorded successfully.",
            sender=sender.lower(),
            action=action,
            sender_score=sender_score,
        )

    @app.route("/review", methods=["POST"])
    @app.route("/api/review", methods=["POST"])
    def review_email():
        payload = request.get_json(silent=True) or {}
        email_id = str(payload.get("email_id") or "").strip()
        if not email_id:
            return _error_response("Payload must include an email_id.")

        try:
            notification_service.mark_reviewed(email_id)
        except Exception as exc:  # pragma: no cover
            LOGGER.exception("Failed to mark email as reviewed.")
            return _error_response(f"Unable to mark reviewed: {exc}", 500)

        return _success_response(message="Email marked as reviewed.", email_id=email_id)

    @app.route("/rules", methods=["POST"])
    @app.route("/api/rules", methods=["POST"])
    def update_rules():
        payload = request.get_json(silent=True) or {}
        sender = str(payload.get("sender") or "").strip()
        scope = str(payload.get("scope") or "").strip().lower()
        rule = str(payload.get("rule") or "").strip().lower()

        if not sender:
            return _error_response("Payload must include a sender.")

        try:
            notification_service.set_rule(sender, scope, rule)
        except ValueError as exc:
            return _error_response(str(exc))
        except Exception as exc:  # pragma: no cover
            LOGGER.exception("Failed to update sender/domain rule.")
            return _error_response(f"Unable to update rule: {exc}", 500)

        return _success_response(
            message="Rule updated successfully.",
            sender=sender.lower(),
            scope=scope,
            rule=rule,
        )

    @app.route("/api/retrain", methods=["POST"])
    def retrain_model():
        try:
            priority_model.train()
            emails = notification_service.list_dataset_emails()
            return _success_response(
                message="Model retrained successfully.",
                count=len(emails),
                emails=emails,
                model_metrics=priority_model.metrics,
                source="dataset",
            )
        except (FileNotFoundError, ValueError) as exc:
            LOGGER.warning("Model retrain issue: %s", exc)
            return _error_response(str(exc), 400)
        except Exception as exc:  # pragma: no cover
            LOGGER.exception("Failed to retrain model.")
            return _error_response(f"Unable to retrain model: {exc}", 500)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=False, use_reloader=False)
