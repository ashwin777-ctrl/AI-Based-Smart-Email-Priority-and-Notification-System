const emailList = document.getElementById("emailList");
const searchInput = document.getElementById("searchInput");
const retrainBtn = document.getElementById("retrainBtn");
const feedbackMessage = document.getElementById("feedbackMessage");
const template = document.getElementById("emailRowTemplate");
const navItems = document.querySelectorAll(".nav-item");

let cachedEmails = [];
let activeFilter = "all";

async function fetchEmails(endpoint = "/emails", options = {}) {
    const response = await fetch(endpoint, options);
    if (!response.ok) {
        throw new Error("Unable to load email data.");
    }
    return response.json();
}

function updateStats(emails, metrics) {
    document.getElementById("datasetSize").textContent = emails.length;
    document.getElementById("modelAccuracy").textContent = `${Math.round((metrics.accuracy || 0) * 100)}%`;
    document.getElementById("inboxCount").textContent = emails.length;
    document.getElementById("importantCount").textContent = emails.filter(
        (email) => email.priority === "High"
    ).length;
    document.getElementById("spamCount").textContent = emails.filter(
        (email) => String(email.category).toLowerCase() === "spam"
    ).length;
    document.getElementById("immediateCount").textContent = emails.filter(
        (email) => email.notification_decision === "Immediate"
    ).length;
}

function getPriorityIcon(priority) {
    if (priority === "High") {
        return "!";
    }
    if (priority === "Medium") {
        return "C";
    }
    return "OK";
}

function showFeedback(message, isError = false) {
    feedbackMessage.hidden = false;
    feedbackMessage.textContent = message;
    feedbackMessage.style.background = isError ? "#fef2f2" : "#ecfdf3";
    feedbackMessage.style.color = isError ? "#991b1b" : "#14532d";
}

function renderEmails(emails) {
    emailList.innerHTML = "";

    if (!emails.length) {
        emailList.innerHTML = '<div class="empty-state">No emails match your current view.</div>';
        return;
    }

    emails.forEach((email) => {
        const node = template.content.firstElementChild.cloneNode(true);
        const priorityIcon = node.querySelector(".priority-icon");
        const decisionBadge = node.querySelector(".decision-badge");

        priorityIcon.textContent = getPriorityIcon(email.priority);
        priorityIcon.classList.add(email.priority.toLowerCase());
        decisionBadge.textContent = email.notification_decision;
        decisionBadge.classList.add(email.notification_decision.toLowerCase());

        node.querySelector(".email-sender").textContent = email.sender || "unknown";
        node.querySelector(".email-subject").textContent = email.subject;
        node.querySelector(".email-message").textContent = email.message;
        node.querySelector(".email-date").textContent = email.date || "No date";
        node.querySelector(".email-priority-text").textContent = `${email.priority} priority`;
        node.querySelector(".email-confidence").textContent = `${email.notification_decision} notification`;

        node.querySelector(".mark-btn").addEventListener("click", () => {
            submitFeedback(email.sender, "opened");
        });
        node.querySelector(".ignore-btn").addEventListener("click", () => {
            submitFeedback(email.sender, "ignored");
        });

        emailList.appendChild(node);
    });
}

function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = cachedEmails.filter((email) => {
        const matchesSearch =
            email.subject.toLowerCase().includes(query) ||
            email.message.toLowerCase().includes(query) ||
            email.notification_decision.toLowerCase().includes(query) ||
            email.priority.toLowerCase().includes(query) ||
            email.sender.toLowerCase().includes(query);

        const matchesFolder =
            activeFilter === "all" ||
            (activeFilter === "high" && email.priority === "High") ||
            (activeFilter === "spam" && String(email.category).toLowerCase() === "spam");

        return matchesSearch && matchesFolder;
    });

    renderEmails(filtered);
}

async function submitFeedback(sender, action) {
    try {
        const response = await fetch("/feedback", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ sender, action }),
        });

        if (!response.ok) {
            throw new Error("Unable to save feedback.");
        }

        const data = await response.json();
        showFeedback(`${sender} marked as ${action}. Sender score is now ${data.sender_score}.`);
        await loadDashboard(false);
    } catch (error) {
        showFeedback(error.message, true);
    }
}

async function loadDashboard(showLoading = true) {
    try {
        if (showLoading) {
            retrainBtn.disabled = true;
            retrainBtn.textContent = "Loading...";
        }

        const data = await fetchEmails();
        cachedEmails = data.emails;
        updateStats(data.emails, data.model_metrics);
        applyFilters();
    } catch (error) {
        emailList.innerHTML = `<div class="empty-state">${error.message}</div>`;
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
        showFeedback("Model retrained and inbox refreshed.");
        applyFilters();
    } catch (error) {
        emailList.innerHTML = `<div class="empty-state">${error.message}</div>`;
    } finally {
        retrainBtn.disabled = false;
        retrainBtn.textContent = "Retrain Model";
    }
});

searchInput.addEventListener("input", applyFilters);

navItems.forEach((item) => {
    item.addEventListener("click", () => {
        navItems.forEach((navItem) => navItem.classList.remove("active"));
        item.classList.add("active");
        activeFilter = item.dataset.filter;
        applyFilters();
    });
});

loadDashboard();
