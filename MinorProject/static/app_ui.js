const emailList = document.getElementById("emailList");
const searchInput = document.getElementById("searchInput");
const retrainBtn = document.getElementById("retrainBtn");
const feedbackBanner = document.getElementById("feedbackMessage");
const emailTemplate = document.getElementById("emailRowTemplate");
const sidebarButtons = document.querySelectorAll(".nav-item");
const inboxModeText = document.getElementById("inboxModeText");
const sourcePill = document.getElementById("sourcePill");
const metricsChart = document.getElementById("metricsChart");
const confusionMatrixChart = document.getElementById("confusionMatrixChart");
const mailDetailModal = document.getElementById("mailDetailModal");
const mailDetailBackdrop = document.getElementById("mailDetailBackdrop");
const closeMailDetailButton = document.getElementById("closeMailDetail");
const mailDetailSender = document.getElementById("mailDetailSender");
const mailDetailSubject = document.getElementById("mailDetailSubject");
const mailDetailDate = document.getElementById("mailDetailDate");
const mailDetailPriority = document.getElementById("mailDetailPriority");
const mailDetailDecision = document.getElementById("mailDetailDecision");
const mailDetailBody = document.getElementById("mailDetailBody");
const mailDetailReasonTags = document.getElementById("mailDetailReasonTags");
const whitelistSenderBtn = document.getElementById("whitelistSenderBtn");
const blacklistSenderBtn = document.getElementById("blacklistSenderBtn");
const whitelistDomainBtn = document.getElementById("whitelistDomainBtn");
const blacklistDomainBtn = document.getElementById("blacklistDomainBtn");

let allEmails = [];
let activeFolder = "all";
let currentSource = "dataset";
let activeEmail = null;

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
}

function updateOverview(emails, metrics) {
    document.getElementById("datasetSize").textContent = emails.length;
    document.getElementById("modelAccuracy").textContent = `${Math.round((metrics.accuracy || 0) * 100)}%`;
    document.getElementById("inboxCount").textContent = emails.length;
    document.getElementById("importantCount").textContent = emails.filter(
        (email) => email.priority === "High"
    ).length;
    document.getElementById("spamCount").textContent = emails.filter(
        (email) => String(email.category || "").toLowerCase() === "spam" || email.priority === "Low"
    ).length;
    document.getElementById("immediateCount").textContent = emails.filter(
        (email) => (email.notification_decision || email.notification) === "Immediate"
    ).length;
}

function updateSourceState(source, mailboxConnected) {
    currentSource = source || "dataset";

    if (sourcePill) {
        sourcePill.textContent = `Source: ${currentSource}`;
    }

    if (!inboxModeText) {
        return;
    }

    if (mailboxConnected && currentSource === "mailbox") {
        inboxModeText.textContent =
            "Live mailbox mode: recent inbox emails are classified as they arrive.";
        return;
    }

    inboxModeText.textContent =
        "Dataset mode: connect your mailbox to classify new incoming emails.";
}

function withCacheBust(url) {
    if (!url) {
        return "";
    }
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}ts=${Date.now()}`;
}

function updateCharts(metrics) {
    const metricsUrl = metrics.metrics_chart_url || metrics.accuracy_chart_url || "";
    const confusionUrl = metrics.confusion_matrix_chart_url || "";

    if (metricsChart) {
        metricsChart.hidden = !metricsUrl;
        metricsChart.src = metricsUrl ? withCacheBust(metricsUrl) : "";
    }

    if (confusionMatrixChart) {
        confusionMatrixChart.hidden = !confusionUrl;
        confusionMatrixChart.src = confusionUrl ? withCacheBust(confusionUrl) : "";
    }
}

function previewText(message) {
    const normalizedMessage = String(message || "").replace(/\s+/g, " ").trim();
    if (!normalizedMessage) {
        return "No message preview available.";
    }

    if (normalizedMessage.length <= 180) {
        return normalizedMessage;
    }

    return `${normalizedMessage.slice(0, 180).trim()}...`;
}

function createReasonTag(label) {
    const tag = document.createElement("span");
    tag.className = "reason-tag";
    tag.textContent = label;
    return tag;
}

function renderReasonTags(container, tags = []) {
    if (!container) {
        return;
    }

    container.innerHTML = "";
    tags.forEach((tag) => {
        container.appendChild(createReasonTag(tag));
    });
}

function openMailDetail(email) {
    if (!mailDetailModal) {
        return;
    }

    const priority = email.priority || "Low";
    const decision = email.notification_decision || email.notification || "Delayed";

    mailDetailSender.textContent = email.sender_name || email.sender || "unknown";
    mailDetailSubject.textContent = email.subject || "(No subject)";
    mailDetailDate.textContent = email.date || "No date";
    mailDetailPriority.textContent = `${priority} priority`;
    mailDetailDecision.textContent = `${decision} notification`;
    mailDetailBody.textContent = email.message || "No message body available.";
    renderReasonTags(mailDetailReasonTags, email.reason_tags || []);
    mailDetailModal.hidden = false;
    document.body.classList.add("modal-open");
    activeEmail = email;
    markReviewed(email.id);
}

function closeMailDetail() {
    if (!mailDetailModal) {
        return;
    }

    mailDetailModal.hidden = true;
    document.body.classList.remove("modal-open");
}

function prioritySymbol(priority) {
    if (priority === "High") {
        return "!";
    }
    if (priority === "Medium") {
        return "C";
    }
    return "OK";
}

function showBanner(message, isError = false) {
    feedbackBanner.hidden = false;
    feedbackBanner.textContent = message;
    feedbackBanner.style.background = isError ? "#fef2f2" : "#ecfdf3";
    feedbackBanner.style.color = isError ? "#991b1b" : "#14532d";
}

function clearBanner() {
    feedbackBanner.hidden = true;
    feedbackBanner.textContent = "";
}

function createEmailRow(email) {
    const row = emailTemplate.content.firstElementChild.cloneNode(true);
    const priorityNode = row.querySelector(".priority-icon");
    const decisionNode = row.querySelector(".decision-badge");
    const priority = email.priority || "Low";
    const decision = email.notification_decision || email.notification || "Delayed";
    const senderName = email.sender_name || email.sender || "unknown";
    const subject = email.subject || "(No subject)";
    const message = email.message || "(No message preview)";
    const source = email.source || currentSource;

    priorityNode.textContent = prioritySymbol(priority);
    priorityNode.classList.add(priority.toLowerCase());

    decisionNode.textContent = decision;
    decisionNode.classList.add(decision.toLowerCase());

    row.querySelector(".email-sender").textContent = senderName;
    row.querySelector(".email-subject").textContent = subject;
    row.querySelector(".email-message").textContent = previewText(message);
    row.querySelector(".email-date").textContent = email.date || "No date";
    row.querySelector(".email-priority-text").textContent = `${priority} priority`;
    row.querySelector(".email-confidence").textContent = `${decision} notification | ${source}`;
    renderReasonTags(row.querySelector(".reason-tags"), email.reason_tags || []);
    if (email.reviewed) {
        row.classList.add("reviewed");
    }
    row.addEventListener("click", (event) => {
        if (event.target.closest(".action-btn")) {
            return;
        }
        openMailDetail(email);
    });

    row.querySelector(".mark-btn").addEventListener("click", () => {
        sendFeedback(email.sender, "opened");
    });

    row.querySelector(".ignore-btn").addEventListener("click", () => {
        sendFeedback(email.sender, "ignored");
    });

    return row;
}

function renderEmails(emails) {
    emailList.innerHTML = "";

    if (!emails.length) {
        emailList.innerHTML = '<div class="empty-state">No emails match your current view.</div>';
        return;
    }

    emails.forEach((email) => {
        emailList.appendChild(createEmailRow(email));
    });
}

function getVisibleEmails() {
    const query = searchInput.value.trim().toLowerCase();

    return allEmails.filter((email) => {
        const matchesFolder =
            activeFolder === "all" ||
            (activeFolder === "high" && email.priority === "High") ||
            (
                activeFolder === "spam" &&
                (String(email.category || "").toLowerCase() === "spam" || email.priority === "Low")
            );

        const matchesQuery =
            String(email.subject || "").toLowerCase().includes(query) ||
            String(email.message || "").toLowerCase().includes(query) ||
            String(email.sender || "").toLowerCase().includes(query) ||
            String(email.sender_name || "").toLowerCase().includes(query) ||
            String(email.priority || "").toLowerCase().includes(query) ||
            String(email.notification_decision || email.notification || "").toLowerCase().includes(query);

        return matchesFolder && matchesQuery;
    });
}

function refreshEmailList() {
    renderEmails(getVisibleEmails());
}

async function loadEmails(showLoading = true) {
    try {
        if (showLoading) {
            clearBanner();
            retrainBtn.disabled = true;
            retrainBtn.textContent = "Loading...";
        }

        const payload = await requestJson("/emails");
        allEmails = payload.emails || [];
        updateOverview(allEmails, payload.model_metrics || {});
        updateCharts(payload.model_metrics || {});
        updateSourceState(payload.source, payload.mailbox_connected);
        refreshEmailList();
    } catch (error) {
        updateSourceState("dataset", false);
        emailList.innerHTML = `<div class="empty-state">${error.message}</div>`;
    } finally {
        retrainBtn.disabled = false;
        retrainBtn.textContent = "Retrain Model";
    }
}

async function sendFeedback(sender, action) {
    try {
        const payload = await requestJson("/feedback", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ sender, action }),
        });

        showBanner(`${sender} marked as ${action}. Sender score: ${payload.sender_score}.`);
        await loadEmails(false);
    } catch (error) {
        showBanner(error.message, true);
    }
}

async function markReviewed(emailId) {
    if (!emailId) {
        return;
    }

    try {
        await requestJson("/review", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ email_id: emailId }),
        });
        allEmails = allEmails.map((email) => (
            email.id === emailId ? { ...email, reviewed: true } : email
        ));
        refreshEmailList();
    } catch (error) {
        showBanner(error.message, true);
    }
}

async function updateRule(sender, scope, rule) {
    try {
        await requestJson("/rules", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ sender, scope, rule }),
        });
        showBanner(`${scope} rule updated for ${sender}.`);
        await loadEmails(false);
    } catch (error) {
        showBanner(error.message, true);
    }
}

retrainBtn.addEventListener("click", async () => {
    try {
        retrainBtn.disabled = true;
        retrainBtn.textContent = "Retraining...";

        const payload = await requestJson("/api/retrain", { method: "POST" });
        allEmails = payload.emails || [];
        updateOverview(allEmails, payload.model_metrics || {});
        updateCharts(payload.model_metrics || {});
        updateSourceState(payload.source, false);
        showBanner("Model retrained and inbox refreshed.");
        refreshEmailList();
    } catch (error) {
        showBanner(error.message, true);
    } finally {
        retrainBtn.disabled = false;
        retrainBtn.textContent = "Retrain Model";
    }
});

searchInput.addEventListener("input", refreshEmailList);

sidebarButtons.forEach((button) => {
    button.addEventListener("click", () => {
        sidebarButtons.forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        activeFolder = button.dataset.filter;
        refreshEmailList();
    });
});

if (closeMailDetailButton) {
    closeMailDetailButton.addEventListener("click", closeMailDetail);
}

if (mailDetailBackdrop) {
    mailDetailBackdrop.addEventListener("click", closeMailDetail);
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeMailDetail();
    }
});

if (whitelistSenderBtn) {
    whitelistSenderBtn.addEventListener("click", () => {
        if (activeEmail) {
            updateRule(activeEmail.sender, "sender", "whitelist");
        }
    });
}

if (blacklistSenderBtn) {
    blacklistSenderBtn.addEventListener("click", () => {
        if (activeEmail) {
            updateRule(activeEmail.sender, "sender", "blacklist");
        }
    });
}

if (whitelistDomainBtn) {
    whitelistDomainBtn.addEventListener("click", () => {
        if (activeEmail) {
            updateRule(activeEmail.sender, "domain", "whitelist");
        }
    });
}

if (blacklistDomainBtn) {
    blacklistDomainBtn.addEventListener("click", () => {
        if (activeEmail) {
            updateRule(activeEmail.sender, "domain", "blacklist");
        }
    });
}

loadEmails();
