(function () {
    const STATES = {
        INITIALIZING: "INITIALIZING",
        AGENT_OFFLINE: "AGENT_OFFLINE",
        UNAUTHENTICATED: "UNAUTHENTICATED",
        AUTH_PENDING: "AUTH_PENDING",
        AUTHENTICATED: "AUTHENTICATED",
        AWAITING_RESPONSE: "AWAITING_RESPONSE",
        ERROR: "ERROR"
    };

    const RESPONSE_TIMEOUT_MS = 600_000;
    const RECONNECT_INTERVAL_MS = 500;

    let state = STATES.INITIALIZING;
    let ws = null;
    let authUrl = null;
    let responseTimer = null;
    let errorMessage = null;
    let reconnectTimer = null;

    const $ = (sel) => document.querySelector(sel);
    const headerStatus = $("#headerStatus");
    const authBtn = $("#authBtn");
    const authModal = $("#authModal");
    const authUrlDisplay = $("#authUrlDisplay");
    const authUrlLink = $("#authUrlLink");
    const authCodeInput = $("#authCodeInput");
    const authCodeSubmitBtn = $("#authCodeSubmitBtn");
    const cancelAuthModal = $("#cancelAuthModal");
    const modalBackdrop = $("#modalBackdrop");
    const errorBanner = $("#errorBanner");
    const errorMessageEl = $("#errorMessage");
    const dismissError = $("#dismissError");
    const messages = $("#messages");
    const chatInput = $("#chatInput");
    const submitBtn = $("#submitBtn");
    const modelSelector = $("#modelSelector");
    const modelInput = $("#modelInput");
    const modelOptionsContainer = $("#modelOptions");

    let modelDebounceTimer = null;
    let currentModel = "";

    function connect() {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${location.host}/ws`;

        ws = new WebSocket(url);

        ws.onopen = () => {
            console.log("[WS] Connected");
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            send({ action: "get_model" });
        };

        ws.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            handleMessage(data);
        };

        ws.onclose = (event) => {
            console.log("[WS] Disconnected", event.code);
            if (event.code === 4000) {
                transition(STATES.ERROR);
                errorMessage = "Another session is already active";
                renderState();
                return;
            }
            transition(STATES.AGENT_OFFLINE);
            scheduleReconnect();
        };

        ws.onerror = () => { };
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, RECONNECT_INTERVAL_MS);
    }

    function send(msg) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    function transition(newState) {
        const oldState = state;
        state = newState;
        if (oldState !== newState) {
            console.log(`[State] ${oldState} → ${newState}`);
        }
        renderState();
    }

    function handleMessage(data) {
        if (data.type === "auth_status") {
            if (data.status === "authenticated") {
                if (state !== STATES.AWAITING_RESPONSE) {
                    transition(STATES.AUTHENTICATED);
                }
            } else {
                if (state !== STATES.AUTH_PENDING) {
                    transition(STATES.UNAUTHENTICATED);
                }
            }
            return;
        }

        if (data.type === "auth_url_generated") {
            authUrl = data.url;
            transition(STATES.AUTH_PENDING);
            return;
        }

        if (data.type === "auth_success") {
            authUrl = null;
            transition(STATES.AUTHENTICATED);
            return;
        }

        if (data.type === "error") {
            clearResponseTimer();
            errorMessage = data.message || "An unexpected error occurred";
            transition(STATES.ERROR);
            return;
        }

        if (data.type === "message") {
            if (data.role === "assistant") {
                clearResponseTimer();
                transition(STATES.AUTHENTICATED);
            }
            renderMessage(data);
            return;
        }

        if (data.type === "chat_message_in") {
            clearResponseTimer();
            renderMessage({ role: "assistant", body: data.text, created_at: new Date().toISOString() });
            transition(STATES.AUTHENTICATED);
            return;
        }

        if (data.type === "model_updated") {
            currentModel = data.model || "";
            modelInput.value = currentModel;
            updateModelOptionButtons();
            return;
        }
    }

    function renderState() {
        renderInput();
        renderAuthModal();
        renderHeaderStatus();
        renderErrorBanner();
        renderModelSelector();
    }

    function renderInput() {
        const enabled = state === STATES.AUTHENTICATED;
        chatInput.disabled = !enabled;

        if (enabled) {
            chatInput.classList.remove("disabled");
            chatInput.placeholder = "Ask me anything...";
        } else {
            chatInput.classList.add("disabled");
            const placeholders = {
                [STATES.INITIALIZING]: "Connecting to agent...",
                [STATES.AGENT_OFFLINE]: "Agent is offline",
                [STATES.UNAUTHENTICATED]: "Complete authentication to start chatting...",
                [STATES.AUTH_PENDING]: "Complete authentication to start chatting...",
                [STATES.AWAITING_RESPONSE]: "Waiting for response...",
                [STATES.ERROR]: "Dismiss error to continue..."
            };
            chatInput.placeholder = placeholders[state] || "Please wait...";
        }

        submitBtn.disabled = !enabled;
        if (enabled) {
            submitBtn.innerHTML = '<svg class="send-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>';
        } else if (state === STATES.AWAITING_RESPONSE) {
            submitBtn.innerHTML = '<div class="spinner"></div>';
        } else {
            submitBtn.innerHTML = '<svg class="lock-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>';
        }
    }

    function renderAuthModal() {
        if (state === STATES.AUTH_PENDING && authUrl) {
            if (!authModal.open) authModal.showModal();
            authUrlDisplay.classList.remove("hidden");
            authUrlLink.href = authUrl;
            authCodeInput.closest(".auth-code-section").classList.remove("hidden");
            authCodeSubmitBtn.disabled = false;
            authCodeSubmitBtn.textContent = "Submit";
        } else {
            if (authModal.open) authModal.close();
        }

        if (state === STATES.UNAUTHENTICATED) {
            authBtn.classList.remove("hidden");
            authBtn.disabled = false;
            authBtn.innerHTML = '<svg class="btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg> Start Auth';
            authBtn.onclick = startAuth;
        } else if (state === STATES.AUTHENTICATED) {
            authBtn.classList.remove("hidden");
            authBtn.disabled = false;
            authBtn.innerHTML = '<svg class="btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Reauthenticate';
            authBtn.onclick = reauthenticate;
        } else {
            authBtn.classList.add("hidden");
        }
    }

    function renderHeaderStatus() {
        const config = {
            [STATES.INITIALIZING]: { text: "Connecting...", cls: "status-warning" },
            [STATES.AGENT_OFFLINE]: { text: "Agent offline", cls: "status-error" },
            [STATES.UNAUTHENTICATED]: { text: "Authentication required", cls: "status-warning" },
            [STATES.AUTH_PENDING]: { text: "Authentication in progress...", cls: "status-info" },
            [STATES.AUTHENTICATED]: { text: "Ready to help", cls: "status-ready" },
            [STATES.AWAITING_RESPONSE]: { text: "Working...", cls: "status-info" },
            [STATES.ERROR]: { text: "Error occurred", cls: "status-error" }
        };
        const c = config[state] || config[STATES.INITIALIZING];
        headerStatus.textContent = c.text;
        headerStatus.className = "chat-header-status " + c.cls;
    }

    function renderErrorBanner() {
        if (state === STATES.ERROR && errorMessage) {
            errorBanner.classList.remove("hidden");
            errorMessageEl.textContent = errorMessage;
        } else {
            errorBanner.classList.add("hidden");
        }
    }

    function renderMessage(data) {
        const isUser = data.role === "user";
        const date = new Date(data.created_at);
        let hours = date.getHours();
        let minutes = date.getMinutes();
        const ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12 || 12;
        minutes = minutes < 10 ? "0" + minutes : minutes;
        const timeStr = `${hours}:${minutes} ${ampm}`;

        const avatarHtml = isUser
            ? '<div class="avatar avatar-user"><span>U</span></div>'
            : '<div class="avatar avatar-bot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg></div>';

        const bubbleClass = isUser ? "message-user" : "message-bot";

        const html = `
            <div class="message-row">
                <div class="message-avatar">${avatarHtml}</div>
                <div class="message-content">
                    <div class="message-bubble ${bubbleClass}">${escapeHtml(data.body)}</div>
                    <div class="message-time-wrapper"><time class="message-time">${timeStr}</time></div>
                </div>
            </div>
        `;

        messages.insertAdjacentHTML("beforeend", html);
        messages.scrollTop = messages.scrollHeight;
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function startAuth() {
        authBtn.disabled = true;
        authBtn.innerHTML = '<div class="spinner"></div> Starting...';
        transition(STATES.AUTH_PENDING);
        send({ action: "initiate_auth" });
    }

    function reauthenticate() {
        if (!confirm("This will clear your current authentication. Are you sure?")) return;
        transition(STATES.AUTH_PENDING);
        send({ action: "reauthenticate" });
    }

    function cancelAuth() {
        authUrl = null;
        send({ action: "cancel_auth" });
        transition(STATES.UNAUTHENTICATED);
    }

    function submitAuthCode() {
        const code = authCodeInput.value.trim();
        if (!code) return;
        authCodeSubmitBtn.disabled = true;
        authCodeSubmitBtn.innerHTML = '<div class="spinner"></div>';
        send({ action: "submit_auth_code", code });
        authCodeInput.value = "";
    }

    function submitMessage(e) {
        if (e) {
            if (e.type === "keydown" && (e.key !== "Enter" || e.shiftKey)) return;
            e.preventDefault();
        }
        if (state !== STATES.AUTHENTICATED) return;
        const text = chatInput.value.trim();
        if (!text) return;

        chatInput.value = "";
        transition(STATES.AWAITING_RESPONSE);
        startResponseTimer();
        send({ action: "send_chat_message", text });
    }

    function startResponseTimer() {
        clearResponseTimer();
        responseTimer = setTimeout(() => {
            errorMessage = "Response timed out. The AI took too long to respond.";
            transition(STATES.ERROR);
        }, RESPONSE_TIMEOUT_MS);
    }

    function clearResponseTimer() {
        if (responseTimer) {
            clearTimeout(responseTimer);
            responseTimer = null;
        }
    }

    function handleDismissError() {
        errorMessage = null;
        transition(STATES.AUTHENTICATED);
    }

    async function loadMessages() {
        try {
            const res = await fetch("/api/messages");
            const data = await res.json();
            messages.innerHTML = "";
            data.forEach(renderMessage);
        } catch {
            console.error("[Chat] Failed to load message history");
        }
    }

    chatInput.addEventListener("keydown", submitMessage);
    submitBtn.addEventListener("click", submitMessage);
    dismissError.addEventListener("click", handleDismissError);
    cancelAuthModal.addEventListener("click", cancelAuth);
    modalBackdrop.addEventListener("click", cancelAuth);
    authCodeSubmitBtn.addEventListener("click", submitAuthCode);

    loadMessages();
    connect();
    loadModelOptions();

    function loadModelOptions() {
        fetch("/api/model-options")
            .then(res => res.json())
            .then(options => {
                modelOptionsContainer.innerHTML = "";
                options.forEach(opt => {
                    const btn = document.createElement("button");
                    btn.className = "model-option-btn";
                    btn.textContent = opt;
                    btn.addEventListener("click", () => {
                        const newModel = currentModel === opt ? "" : opt;
                        modelInput.value = newModel;
                        sendModelUpdate(newModel);
                    });
                    modelOptionsContainer.appendChild(btn);
                });
            })
            .catch(() => { });
    }

    function sendModelUpdate(model) {
        currentModel = model;
        send({ action: "set_model", model });
        updateModelOptionButtons();
    }

    function updateModelOptionButtons() {
        modelOptionsContainer.querySelectorAll(".model-option-btn").forEach(btn => {
            btn.classList.toggle("active", btn.textContent === currentModel);
        });
    }

    function renderModelSelector() {
        const visible = state === STATES.AUTHENTICATED || state === STATES.AWAITING_RESPONSE;
        if (visible) {
            modelSelector.classList.remove("hidden");
        } else {
            modelSelector.classList.add("hidden");
        }
    }

    modelInput.addEventListener("input", () => {
        clearTimeout(modelDebounceTimer);
        modelDebounceTimer = setTimeout(() => {
            sendModelUpdate(modelInput.value.trim());
        }, 500);
    });
})();
