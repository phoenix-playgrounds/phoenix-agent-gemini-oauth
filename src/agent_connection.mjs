import WebSocket from "ws";
import { EventEmitter } from "events";

export const OutboundAction = {
    STATUS_RESPONSE: "status_response",
    AUTH_STATUS_RESPONSE: "auth_status_response",
    CHANGE_STATUS: "change_status",
    URL_GENERATED: "url_generated",
    AUTH_SUCCESS: "auth_success",
    PROMPT_COMPLETED: "prompt_completed",
    PROMPT_FAILED: "prompt_failed",
    ADD_MESSAGE: "add_message"
};

export class AgentConnection extends EventEmitter {
    constructor() {
        super();
        this.wsUrl = process.env.WS_URL || 'ws://localhost:8080/cable';
        this.agentSecret = process.env.AGENT_SECRET ? String(process.env.AGENT_SECRET) : undefined;

        if (!this.agentSecret) {
            console.warn("⚠️ Warning: AGENT_SECRET is not set in environment! Agent will fail to authenticate with the Rails server.");
        }
    }

    connect() {
        console.log(`Connecting to WS_URL: ${this.wsUrl}`);
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
            console.log(`Connected to ActionCable at ${this.wsUrl}`);
        });

        this.ws.on('message', (data) => this._handleMessage(data));

        this.ws.on('close', () => {
            console.log("WebSocket Connection Closed.");
            this.emit('close');
        });

        this.ws.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                console.error(`\n❌ Connection refused to Rails server at ${this.wsUrl}`);
                console.error("Ensuring that Docker compose will retry automatically in a moment...\n");
                process.exit(1);
            } else {
                console.error("WebSocket Error: ", err);
                this.emit('error', err);
            }
        });

        return this.ws;
    }

    _getChannelIdentifier() {
        return {
            channel: "AuthChannel",
            agent_secret: this.agentSecret
        };
    }

    _handleMessage(data) {
        let message;
        try {
            message = JSON.parse(data.toString());
            if (message.type !== "ping") {
                console.log(`[WS RECV] msgType=${message.type || 'data'} data=${JSON.stringify(message.message || message)}`);
            }
        } catch {
            console.error(`[WS RECV ERROR] Received invalid JSON over websocket: ${data.toString()}`);
            return;
        }

        if (message.type === "welcome") {
            console.log("Received welcome message. Subscribing to AuthChannel...");
            this.ws.send(JSON.stringify({
                command: "subscribe",
                identifier: JSON.stringify(this._getChannelIdentifier())
            }));
        } else if (message.type === "confirm_subscription") {
            console.log("Subscription confirmed! Waiting for instructions...");
            this.emit('connected');
        } else if (message.type === "reject_subscription") {
            console.error("❌ Subscription rejected by Rails server! Check if AGENT_SECRET matches the database.");
            this.ws.close();
        } else if (message.type === "ping") {
            // Ignore ping messages
            return;
        } else if (message.message) {
            this._handleInstruction(message.message);
        }
    }

    _handleInstruction(payload) {
        if (payload.type === 'STATUS' || payload.status) {
            this.emit('request_status');
        } else if (payload.type === 'AUTH_STATUS' || payload.auth_status) {
            this.emit('request_auth_status');
        } else if (payload.check_status) {
            this.emit('request_full_status');
        } else if (payload.start_auth) {
            this.emit('start_auth');
        } else if (payload.auth_code) {
            this.emit('auth_code', payload.auth_code);
        } else if (payload.prompt) {
            this.emit('prompt', payload.prompt);
        } else {
            console.log(`[WS] Unhandled payload: ${JSON.stringify(payload)}`);
        }
    }

    // --- Outbound Methods ---

    sendAction(action, payload = {}) {
        const messagePayload = {
            command: "message",
            identifier: JSON.stringify(this._getChannelIdentifier()),
            data: JSON.stringify({ action, ...payload })
        };
        console.log(`[WS SEND] action=${action} payload=${JSON.stringify(payload)}`);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(messagePayload));
        } else {
            console.warn(`[WS SEND WARNING] Cannot send message, WebSocket is not open.`);
        }
    }

    sendStatusResponse(status) {
        this.sendAction(OutboundAction.STATUS_RESPONSE, { status });
    }

    sendAuthStatusResponse(status) {
        this.sendAction(OutboundAction.AUTH_STATUS_RESPONSE, { status });
    }

    sendAuthSuccess() {
        this.sendAction(OutboundAction.AUTH_SUCCESS, { status: 'completed' });
    }

    sendPromptCompleted(result) {
        this.sendAction(OutboundAction.PROMPT_COMPLETED, { result });
    }

    sendPromptFailed(error) {
        this.sendAction(OutboundAction.PROMPT_FAILED, { error });
    }
}
