import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import { resolveStrategy } from "./strategies/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.resolve(__dirname, "../SYSTEM_PROMPT.md");

export class Orchestrator extends EventEmitter {
    constructor() {
        super();
        this.strategy = resolveStrategy();
        this.isAuthenticated = false;
        this.isProcessing = false;
        this._ready = this._initAuthStatus();
    }

    async _initAuthStatus() {
        this.isAuthenticated = await this.strategy.checkAuthStatus();
    }

    handleClientConnected() {
        this._send("auth_status", { status: this.isAuthenticated ? "authenticated" : "unauthenticated" });
    }

    async handleClientMessage(msg) {
        const action = msg.action;

        if (action === "check_auth_status") {
            await this._checkAndSendAuthStatus();
        } else if (action === "initiate_auth") {
            await this._handleInitiateAuth();
        } else if (action === "submit_auth_code") {
            this._handleSubmitAuthCode(msg.code);
        } else if (action === "cancel_auth") {
            this._handleCancelAuth();
        } else if (action === "reauthenticate") {
            await this._handleReauthenticate();
        } else if (action === "send_chat_message") {
            await this._handleChatMessage(msg.text);
        } else {
            console.warn(`[Orchestrator] Unknown action: ${action}`);
        }
    }

    _send(type, data = {}) {
        this.emit("outbound", type, data);
    }

    async _checkAndSendAuthStatus() {
        this.isAuthenticated = await this.strategy.checkAuthStatus();
        this._send("auth_status", { status: this.isAuthenticated ? "authenticated" : "unauthenticated" });
    }

    async _handleInitiateAuth() {
        console.log("[Orchestrator] initiate_auth");
        const currentlyAuthenticated = await this.strategy.checkAuthStatus();
        if (currentlyAuthenticated) {
            this.isAuthenticated = true;
            this._send("auth_success");
        } else {
            const connection = this._createStrategyBridge();
            this.strategy.executeAuth(connection);
        }
    }

    _handleSubmitAuthCode(code) {
        console.log("[Orchestrator] submit_auth_code");
        this.strategy.submitAuthCode(code);
    }

    _handleCancelAuth() {
        console.log("[Orchestrator] cancel_auth");
        this.strategy.cancelAuth();
        this.isAuthenticated = false;
        this._send("auth_status", { status: "unauthenticated" });
    }

    async _handleReauthenticate() {
        console.log("[Orchestrator] reauthenticate");
        this.strategy.cancelAuth();
        this.strategy.clearCredentials();
        this.isAuthenticated = false;
        this._send("auth_status", { status: "unauthenticated" });
        const connection = this._createStrategyBridge();
        this.strategy.executeAuth(connection);
    }

    async _handleChatMessage(text) {
        if (!this.isAuthenticated) {
            this._send("error", { message: "NEED_AUTH" });
            return;
        }
        if (this.isProcessing) {
            this._send("error", { message: "BLOCKED" });
            return;
        }

        console.log("[Orchestrator] send_chat_message");
        this.isProcessing = true;

        try {
            const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf8");
            const fullPrompt = `${systemPrompt}\n\n${text}`;
            const result = await this.strategy.executePrompt(fullPrompt);
            this._send("chat_message_in", { text: result });
        } catch (err) {
            this._send("error", { message: err.message });
        } finally {
            this.isProcessing = false;
        }
    }

    _createStrategyBridge() {
        return {
            sendAuthUrlGenerated: (url) => this._send("auth_url_generated", { url }),
            sendAuthSuccess: () => {
                this.isAuthenticated = true;
                this._send("auth_success");
            },
            sendAuthStatus: (status) => this._send("auth_status", { status }),
            sendError: (message) => this._send("error", { message })
        };
    }
}
