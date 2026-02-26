import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import { resolveStrategy } from "./strategies/index.mjs";
import { MessageStore } from "./message_store.mjs";
import { ModelStore } from "./model_store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.resolve(__dirname, "../SYSTEM_PROMPT.md");

export class Orchestrator extends EventEmitter {
    constructor() {
        super();
        this.strategy = resolveStrategy();
        this.messages = new MessageStore();
        this.modelStore = new ModelStore();
        this.isAuthenticated = false;
        this.isProcessing = false;
        this._ready = this._initAuthStatus();
    }

    async _initAuthStatus() {
        const previousState = this.isAuthenticated;
        this.isAuthenticated = await this.strategy.checkAuthStatus();

        if (this.isAuthenticated !== previousState) {
            this._send("auth_status", {
                status: this.isAuthenticated ? "authenticated" : "unauthenticated",
                isProcessing: this.isProcessing
            });
        }
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
        } else if (action === "logout") {
            this._handleLogout();
        } else if (action === "send_chat_message") {
            await this._handleChatMessage(msg.text);
        } else if (action === "get_model") {
            this._handleGetModel();
        } else if (action === "set_model") {
            this._handleSetModel(msg.model);
        } else {
            console.warn(`[Orchestrator] Unknown action: ${action}`);
        }
    }

    _send(type, data = {}) {
        this.emit("outbound", type, data);
    }

    async _checkAndSendAuthStatus() {
        this.isAuthenticated = await this.strategy.checkAuthStatus();
        this._send("auth_status", {
            status: this.isAuthenticated ? "authenticated" : "unauthenticated",
            isProcessing: this.isProcessing
        });
    }

    handleClientConnected() {
        this._send("auth_status", {
            status: this.isAuthenticated ? "authenticated" : "unauthenticated",
            isProcessing: this.isProcessing
        });
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
        this._send("auth_status", { status: "unauthenticated", isProcessing: this.isProcessing });
    }

    async _handleReauthenticate() {
        console.log("[Orchestrator] reauthenticate");
        this.strategy.cancelAuth();
        this.strategy.clearCredentials();
        this.isAuthenticated = false;
        this._send("auth_status", { status: "unauthenticated", isProcessing: this.isProcessing });
        const connection = this._createStrategyBridge();
        this.strategy.executeAuth(connection);
    }

    _handleLogout() {
        console.log("[Orchestrator] logout");
        this.strategy.cancelAuth();
        this.isAuthenticated = false;
        this.isProcessing = false;
        this._send("auth_status", { status: "unauthenticated", isProcessing: false });
        const connection = this._createLogoutBridge();
        this.strategy.executeLogout(connection);
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

        const userMessage = this.messages.add("user", text);
        this._send("message", userMessage);

        try {
            const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf8");
            const fullPrompt = `${systemPrompt}\n\n${text}`;
            const model = this.modelStore.get();

            let accumulated = "";
            this._send("stream_start", {});

            await this.strategy.executePromptStreaming(fullPrompt, model, (chunk) => {
                accumulated += chunk;
                this._send("stream_chunk", { text: chunk });
            });

            const finalText = accumulated || "Process completed successfully but returned no output.";
            this.messages.add("assistant", finalText);
            this._send("stream_end", {});
        } catch (err) {
            this._send("error", { message: err.message });
        } finally {
            this.isProcessing = false;
        }
    }

    _createStrategyBridge() {
        return {
            sendAuthUrlGenerated: (url) => this._send("auth_url_generated", { url }),
            sendDeviceCode: (code) => this._send("auth_device_code", { code }),
            sendAuthSuccess: () => {
                this.isAuthenticated = true;
                this._send("auth_success");
            },
            sendAuthStatus: (status) => this._send("auth_status", { status }),
            sendError: (message) => this._send("error", { message })
        };
    }

    _createLogoutBridge() {
        return {
            sendLogoutOutput: (text) => this._send("logout_output", { text }),
            sendLogoutSuccess: () => {
                this.isAuthenticated = false;
                this._send("logout_success");
            },
            sendError: (message) => this._send("error", { message })
        };
    }

    _handleGetModel() {
        this._send("model_updated", { model: this.modelStore.get() });
    }

    _handleSetModel(model) {
        const value = this.modelStore.set(model);
        this._send("model_updated", { model: value });
    }
}
