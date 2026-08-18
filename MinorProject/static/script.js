const emailGrid = document.getElementById("emailGrid");
const searchInput = document.getElementById("searchInput");
const retrainBtn = document.getElementById("retrainBtn");
const template = document.getElementById("emailCardTemplate");

let cachedEmails = [];

async function fetchEmails(endpoint = "/api/emails", options = {}) {
    const response = await fetch(endpoint, options);
    if (!response.ok) {
        throw new Error("Unable to load email data.");
    }
    return response.json();
}

function updateStats(emails, metrics) {
    document.getElementById("datasetSize").textContent = emails.length;
    document.getElementById("modelAccuracy").textContent = `${Math.round((metrics.accuracy || 0) * 100)}%`;
    document.getElementById("highPriorityCount").textContent = emails.filter(
        (email) => email.priority === "High"
    ).length;
    document.getElementById("immediateCount").textContent = emails.filter(
        (email) => email.notification_decision === "Immediate"
    ).length;
}

function renderEmails(emails) {
    emailGrid.innerHTML = "";

    if (!emails.length) {
        emailGrid.innerHTML = '<div class="empty-state">No emails match your current search.</div>';
        return;
    }

    emails.forEach((email) => {
        const node = template.content.firstElementChild.cloneNode(true);
        const priorityClass = email.priority.toLowerCase();
        const decisionClass = email.notification_decision.toLowerCase();

        const priorityBadge = node.querySelector(".priority-badge");
        priorityBadge.textContent = `${email.priority_icon} ${email.priority} Priority`;
        priorityBadge.classList.add(priorityClass);

        const decisionBadge = node.querySelector(".decision-badge");
        decisionBadge.textContent = email.notification_decision;
        decisionBadge.classList.add(decisionClass);

        node.querySelector(".email-subject").textContent = email.subject;
        node.querySelector(".email-message").textContent = email.message;
        node.querySelector(".email-meta").textContent =
            `${email.category} • ${email.date} • Engagement ${email.engagement_score}/100`;
        node.querySelector(".confidence-pill").textContent =
            `Confidence ${Math.round(email.confidence * 100)}%`;

        const keywordList = node.querySelector(".keyword-list");
        if (email.keywords.length) {
            email.keywords.forEach((keyword) => {
                const keywordChip = document.createElement("span");
                keywordChip.className = "keyword-chip";
                keywordChip.textContent = keyword;
                keywordList.appendChild(keywordChip);
            });
        } else {
            const keywordChip = document.createElement("span");
            keywordChip.className = "keyword-chip";
            keywordChip.textContent = "general";
            keywordList.appendChild(keywordChip);
        }

        emailGrid.appendChild(node);
    });
}

function applySearchFilter() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = cachedEmails.filter((email) => {
        return (
            email.subject.toLowerCase().includes(query) ||
            email.message.toLowerCase().includes(query) ||
            email.notification_decision.toLowerCase().includes(query) ||
            email.priority.toLowerCase().includes(query)
        );
    });
    renderEmails(filtered);
}

async function loadDashboard() {
    try {
        retrainBtn.disabled = true;
        retrainBtn.textContent = "Loading...";
        const data = await fetchEmails();
        cachedEmails = data.emails;
        updateStats(data.emails, data.model_metrics);
        renderEmails(data.emails);
    } catch (error) {
        emailGrid.innerHTML = `<div class="empty-state">${error.message}</div>`;
    } finally {
        retrainBtn.disabled = false;
        retrainBtn.textContent = "Retrain Model";
    }
}

retrainBtn.addEventListener("click", async () => {
    try {
        retrainBtn.disabled = true;
        retrainBtn.textContent = "Retraining...";
        const data = await fetchEmails("/api/retrain", { method: "POST" });
        cachedEmails = data.emails;
        updateStats(data.emails, data.model_metrics);
        applySearchFilter();
    } catch (error) {
        emailGrid.innerHTML = `<div class="empty-state">${error.message}</div>`;
    } finally {
        retrainBtn.disabled = false;
        retrainBtn.textContent = "Retrain Model";
    }
});

searchInput.addEventListener("input", applySearchFilter);

loadDashboard();
