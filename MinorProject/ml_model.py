from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import joblib
import matplotlib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline


PRIORITY_ICONS = {
    "High": "High",
    "Medium": "Medium",
    "Low": "Low",
}
BOOST_KEYWORDS = (
    "deadline",
    "urgent",
    "asap",
    "interview",
    "hiring",
    "recruiter",
    "internship",
    "job opening",
    "offer letter",
    "campus placement",
    "college",
    "university",
    "assignment",
    "exam",
    "professor",
    "coursework",
    "project submission",
)
LOW_SIGNAL_KEYWORDS = (
    "digest",
    "newsletter",
    "top stories",
    "recommended for you",
    "daily update",
    "weekly update",
    "trending",
    "quora digest",
    "subscription",
)
REQUIRED_COLUMNS = {"Subject", "Message", "Spam/Ham", "Date"}
DATASET_CANDIDATES = [
    Path(r"C:\Users\asury\OneDrive\Documents\enron_spam_data.csv"),
    Path(__file__).resolve().parent / "data" / "enron_spam_data.csv",
    Path(__file__).resolve().parent / "data" / "emails.csv",
]
DEFAULT_DATASET_PATH = DATASET_CANDIDATES[0]
REPORTS_DIR = Path(__file__).resolve().parent / "reports"
STATIC_REPORTS_DIR = Path(__file__).resolve().parent / "static" / "generated"
MODEL_CACHE_PATH = REPORTS_DIR / "priority_model.joblib"
DEFAULT_FAST_MODE = True
FAST_MODE_SAMPLE_SIZE = 1000

# Use a non-GUI backend so chart generation is safe inside Flask/dev-server threads.
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def _ensure_reports_dir() -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    STATIC_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return REPORTS_DIR


def _dataset_signature(dataset_path: Path) -> Dict[str, object]:
    stat = dataset_path.stat()
    return {
        "path": str(dataset_path.resolve()),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }


def _build_runtime_signature(dataset_path: Path, fast_mode: bool, sample_size: int) -> Dict[str, object]:
    return {
        **_dataset_signature(dataset_path),
        "fast_mode": fast_mode,
        "sample_size": sample_size,
    }


def _resolve_dataset_path(dataset_path: str | Path) -> Path:
    resolved_path = Path(dataset_path)
    if resolved_path.exists():
        return resolved_path

    for candidate in DATASET_CANDIDATES:
        if candidate.exists():
            return candidate

    available_locations = ", ".join(str(path) for path in DATASET_CANDIDATES)
    raise FileNotFoundError(
        f"Dataset not found: {resolved_path}. Checked: {available_locations}"
    )
    return resolved_path


def _combine_text(subject: str, message: str) -> str:
    return f"{subject} {message}".strip()


def _boosted_priority(spam_or_ham: str, combined_text: str) -> str:
    normalized_label = (spam_or_ham or "").strip().lower()
    text = combined_text.lower()

    if any(keyword in text for keyword in BOOST_KEYWORDS):
        return "High"
    if any(keyword in text for keyword in LOW_SIGNAL_KEYWORDS):
        return "Low"
    if normalized_label == "spam":
        return "Low"
    return "Medium"


def _extract_sender(subject: str) -> str:
    normalized_subject = (subject or "").strip()
    if ":" in normalized_subject:
        return normalized_subject.split(":", 1)[0].strip().lower() or "unknown"
    return "unknown"


def _validate_and_prepare_frame(dataframe: pd.DataFrame) -> pd.DataFrame:
    missing_columns = REQUIRED_COLUMNS.difference(dataframe.columns)
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {sorted(missing_columns)}")

    prepared = dataframe.copy()
    prepared["Subject"] = prepared["Subject"].fillna("").astype(str)
    prepared["Message"] = prepared["Message"].fillna("").astype(str)
    prepared["Spam/Ham"] = prepared["Spam/Ham"].fillna("").astype(str).str.strip().str.lower()
    prepared["Date"] = pd.to_datetime(prepared["Date"], errors="coerce")

    # The model is trained on the combined text field expected by the new dataset format.
    prepared["combined_text"] = prepared.apply(
        lambda row: _combine_text(row["Subject"], row["Message"]),
        axis=1,
    )
    prepared["priority"] = prepared.apply(
        lambda row: _boosted_priority(row["Spam/Ham"], row["combined_text"]),
        axis=1,
    )
    prepared["hour"] = prepared["Date"].dt.hour
    prepared["sender"] = prepared["Subject"].apply(_extract_sender)
    prepared["id"] = range(1, len(prepared) + 1)
    return prepared


def _build_confusion_matrix(y_true: pd.Series, predictions: List[str], labels: List[str]) -> List[List[int]]:
    return confusion_matrix(y_true, predictions, labels=labels).tolist()


def _plot_accuracy_chart(metrics: Dict[str, float]) -> Dict[str, str]:
    _ensure_reports_dir()
    metrics_chart_path = STATIC_REPORTS_DIR / "metrics_chart.png"
    accuracy_chart_path = STATIC_REPORTS_DIR / "accuracy_chart.png"

    metric_names = ["Accuracy", "Precision", "Recall", "F1 Score"]
    metric_values = [
        metrics["accuracy"],
        metrics["precision"],
        metrics["recall"],
        metrics["f1_score"],
    ]
    metric_colors = ["#2563eb", "#0891b2", "#f59e0b", "#10b981"]

    plt.figure(figsize=(8, 4.8))
    bars = plt.bar(metric_names, metric_values, color=metric_colors, width=0.55)
    plt.ylim(0, 1)
    plt.ylabel("Score")
    plt.title("Model Metrics Overview")
    plt.grid(axis="y", linestyle="--", alpha=0.25)

    for bar, value in zip(bars, metric_values):
        plt.text(
            bar.get_x() + bar.get_width() / 2,
            value + 0.02,
            f"{value:.2%}",
            ha="center",
            va="bottom",
            fontsize=10,
            fontweight="bold",
        )

    plt.tight_layout()
    plt.savefig(metrics_chart_path, dpi=150)
    plt.close()

    plt.figure(figsize=(6, 4.2))
    bars = plt.bar(["Accuracy"], [metrics["accuracy"]], color="#2563eb", width=0.45)
    plt.ylim(0, 1)
    plt.ylabel("Score")
    plt.title("Email Priority Model Accuracy")
    plt.grid(axis="y", linestyle="--", alpha=0.25)

    for bar in bars:
        height = bar.get_height()
        plt.text(
            bar.get_x() + bar.get_width() / 2,
            height + 0.02,
            f"{height:.2%}",
            ha="center",
            va="bottom",
            fontsize=11,
            fontweight="bold",
        )

    plt.tight_layout()
    plt.savefig(accuracy_chart_path, dpi=150)
    plt.close()

    return {
        "accuracy_chart_path": str(accuracy_chart_path),
        "accuracy_chart_url": "/static/generated/accuracy_chart.png",
        "metrics_chart_path": str(metrics_chart_path),
        "metrics_chart_url": "/static/generated/metrics_chart.png",
    }


def _plot_confusion_matrix_chart(matrix: List[List[int]], labels: List[str]) -> Dict[str, str]:
    _ensure_reports_dir()
    output_path = STATIC_REPORTS_DIR / "confusion_matrix.png"

    plt.figure(figsize=(6.5, 5.2))
    plt.imshow(matrix, interpolation="nearest", cmap="Blues")
    plt.title("Confusion Matrix")
    plt.colorbar(fraction=0.046, pad=0.04)
    tick_positions = range(len(labels))
    plt.xticks(tick_positions, labels)
    plt.yticks(tick_positions, labels)
    plt.xlabel("Predicted")
    plt.ylabel("Actual")

    for row_index, row in enumerate(matrix):
        for column_index, value in enumerate(row):
            plt.text(
                column_index,
                row_index,
                str(value),
                ha="center",
                va="center",
                color="#0f172a" if value < max(max(r) for r in matrix) * 0.65 else "white",
                fontsize=10,
                fontweight="bold",
            )

    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    plt.close()
    return {
        "confusion_matrix_chart_path": str(output_path),
        "confusion_matrix_chart_url": "/static/generated/confusion_matrix.png",
    }


def _print_evaluation_summary(metrics: Dict[str, object]) -> None:
    print("\nModel Evaluation Summary")
    print("=" * 32)
    print(f"Accuracy : {metrics['accuracy']:.4f}")
    print(f"Precision: {metrics['precision']:.4f}")
    print(f"Recall   : {metrics['recall']:.4f}")
    print(f"F1 Score : {metrics['f1_score']:.4f}")
    print("\nConfusion Matrix")
    print("=" * 32)

    labels = metrics["labels"]
    matrix = metrics["confusion_matrix"]
    print("Actual \\ Pred".ljust(14) + " ".join(label.rjust(8) for label in labels))
    for label, row in zip(labels, matrix):
        print(label.ljust(14) + " ".join(str(value).rjust(8) for value in row))

    print("\nArtifacts")
    print("=" * 32)
    print(f"Accuracy chart: {metrics['accuracy_chart_path']}")
    print(f"Metrics chart : {metrics['metrics_chart_path']}")
    print(f"Confusion heatmap: {metrics['confusion_matrix_chart_path']}")


def _load_cached_model(dataset_path: Path, fast_mode: bool, sample_size: int) -> Optional[Dict[str, object]]:
    cache_path = _ensure_reports_dir() / MODEL_CACHE_PATH.name
    if not cache_path.exists():
        return None

    cached_payload = joblib.load(cache_path)
    if cached_payload.get("signature") != _build_runtime_signature(dataset_path, fast_mode, sample_size):
        return None
    return cached_payload


def _save_cached_model(
    dataset_path: Path,
    pipeline: Pipeline,
    metrics: Dict[str, object],
    fast_mode: bool,
    sample_size: int,
) -> None:
    cache_path = _ensure_reports_dir() / MODEL_CACHE_PATH.name
    joblib.dump(
        {
            "signature": _build_runtime_signature(dataset_path, fast_mode, sample_size),
            "pipeline": pipeline,
            "metrics": metrics,
        },
        cache_path,
    )


def _reduce_training_frame(prepared: pd.DataFrame, fast_mode: bool, sample_size: int) -> pd.DataFrame:
    if not fast_mode or len(prepared) <= sample_size:
        return prepared

    labels = prepared["priority"]
    label_counts = labels.value_counts()
    stratify_labels = labels if labels.nunique() > 1 and label_counts.min() >= 2 else None

    sampled_frame, _ = train_test_split(
        prepared,
        train_size=sample_size,
        random_state=42,
        stratify=stratify_labels,
    )
    return sampled_frame.reset_index(drop=True)


def train_model(
    dataset_path: str | Path = DEFAULT_DATASET_PATH,
    fast_mode: bool = DEFAULT_FAST_MODE,
    sample_size: int = FAST_MODE_SAMPLE_SIZE,
) -> Dict[str, object]:
    resolved_dataset_path = _resolve_dataset_path(dataset_path)
    cached_payload = _load_cached_model(resolved_dataset_path, fast_mode, sample_size)
    if cached_payload is not None:
        return {
            "pipeline": cached_payload["pipeline"],
            "metrics": cached_payload["metrics"],
        }

    prepared = _validate_and_prepare_frame(pd.read_csv(resolved_dataset_path))
    if prepared.empty:
        raise ValueError("Dataset must contain at least one email record.")
    prepared = _reduce_training_frame(prepared, fast_mode, sample_size)

    features = prepared["combined_text"]
    labels = prepared["priority"]
    label_counts = labels.value_counts()
    stratify_labels = labels if labels.nunique() > 1 and label_counts.min() >= 2 else None

    x_train, x_test, y_train, y_test = train_test_split(
        features,
        labels,
        test_size=0.45,
        random_state=42,
        stratify=stratify_labels,
    )

    model_pipeline = Pipeline(
        steps=[
            (
                "tfidf",
                TfidfVectorizer(
                    stop_words="english",
                    ngram_range=(1, 1),
                    max_features=90,
                    min_df=8,
                ),
            ),
            (
                "classifier",
                RandomForestClassifier(
                    n_estimators=10,
                    random_state=42,
                    class_weight="balanced_subsample",
                    n_jobs=1,
                    max_depth=5,
                    min_samples_leaf=8,
                ),
            ),
        ]
    )
    model_pipeline.fit(x_train, y_train)

    predictions = model_pipeline.predict(x_test)
    labels_for_matrix = sorted(labels.unique().tolist())
    accuracy = round(float(accuracy_score(y_test, predictions)), 4)
    precision = round(
        float(precision_score(y_test, predictions, average="weighted", zero_division=0)),
        4,
    )
    recall = round(
        float(recall_score(y_test, predictions, average="weighted", zero_division=0)),
        4,
    )
    f1 = round(
        float(f1_score(y_test, predictions, average="weighted", zero_division=0)),
        4,
    )
    chart_paths = _plot_accuracy_chart(
        {
            "accuracy": accuracy,
            "precision": precision,
            "recall": recall,
            "f1_score": f1,
        }
    )
    confusion_chart_paths = _plot_confusion_matrix_chart(
        _build_confusion_matrix(y_test, predictions, labels_for_matrix),
        labels_for_matrix,
    )

    metrics: Dict[str, object] = {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1_score": f1,
        "confusion_matrix": _build_confusion_matrix(y_test, predictions, labels_for_matrix),
        "labels": labels_for_matrix,
        **chart_paths,
        **confusion_chart_paths,
        "support": int(len(prepared)),
        "fast_mode": fast_mode,
        "sample_size": int(len(prepared)),
    }
    _print_evaluation_summary(metrics)
    _save_cached_model(resolved_dataset_path, model_pipeline, metrics, fast_mode, sample_size)
    return {"pipeline": model_pipeline, "metrics": metrics}


@dataclass
class EmailPriorityModel:
    dataset_path: Path = DEFAULT_DATASET_PATH
    model: Optional[Pipeline] = field(default=None, init=False)
    metrics: Dict[str, object] = field(default_factory=dict, init=False)
    last_error: Optional[str] = field(default=None, init=False)
    fast_mode: bool = DEFAULT_FAST_MODE
    sample_size: int = FAST_MODE_SAMPLE_SIZE

    def __post_init__(self) -> None:
        self.dataset_path = Path(self.dataset_path)
        if self.dataset_path.exists():
            try:
                self.train()
            except Exception as exc:
                self.last_error = str(exc)
        else:
            self.last_error = f"Dataset not found: {self.dataset_path}"

    def train(self) -> None:
        training_result = train_model(
            self.dataset_path,
            fast_mode=self.fast_mode,
            sample_size=self.sample_size,
        )
        self.model = training_result["pipeline"]
        self.metrics = training_result["metrics"]
        self.last_error = None

    def load_dataset(self) -> pd.DataFrame:
        resolved_dataset_path = _resolve_dataset_path(self.dataset_path)
        return _validate_and_prepare_frame(pd.read_csv(resolved_dataset_path))

    def predict_priority(self, text: str) -> str:
        normalized_text = (text or "").strip()
        if not normalized_text:
            return "Medium"

        if any(keyword in normalized_text.lower() for keyword in BOOST_KEYWORDS):
            return "High"

        if self.model is None:
            if self.dataset_path.exists():
                self.train()
            else:
                return "Medium"

        return str(self.model.predict([normalized_text])[0])

    def predict_email(
        self,
        subject: str,
        message: str,
        category: str,
        email_date: str | None = None,
    ) -> Dict[str, object]:
        combined_text = _combine_text(subject, message)
        derived_priority = _boosted_priority(category, combined_text)
        model_priority = self.predict_priority(combined_text)
        final_priority = "High" if derived_priority == "High" else model_priority

        if final_priority not in PRIORITY_ICONS:
            final_priority = derived_priority

        parsed_date = pd.to_datetime(email_date, errors="coerce")
        return {
            "priority": final_priority,
            "priority_icon": PRIORITY_ICONS[final_priority],
            "confidence": 1.0 if final_priority == "High" else 0.85,
            "keywords": [keyword for keyword in BOOST_KEYWORDS if keyword in combined_text.lower()],
            "hour": None if pd.isna(parsed_date) else int(parsed_date.hour),
        }

    def get_emails(self, limit: int | None = None) -> List[Dict[str, object]]:
        prepared = self.load_dataset().copy()
        if limit is not None and limit > 0:
            prepared = prepared.head(limit).copy()
        prepared["Date"] = prepared["Date"].apply(
            lambda value: "" if pd.isna(value) else value.isoformat(sep=" ")
        )
        prepared["hour"] = prepared["hour"].where(prepared["hour"].notna(), None)

        return prepared[
            ["id", "Subject", "Message", "Spam/Ham", "Date", "sender", "combined_text", "priority", "hour"]
        ].rename(columns={"priority": "priority_label"}).to_dict(orient="records")


if __name__ == "__main__":
    result = train_model()
    print(result["metrics"])
