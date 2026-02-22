import WebSocket from "ws";
import { EventEmitter } from "events";

export const OutboundAction = {
    PING: "ping",
    AUTH_STATUS: "auth_status",
    AUTH_URL_GENERATED: "auth_url_generated",
    AUTH_SUCCESS: "auth_success",
    CHAT_MESSAGE_IN: "chat_message_in",
    ERROR: "error"
};

export class AgentConnection extends EventEmitter {
    constructor() {
        super();
        this.wsUrl = process.env.WS_URL || 'ws://localhost:8080/cable';
        this.agentSecret = process.env.AGENT_SECRET ? String(process.env.AGENT_SECRET) : undefined;
        this.ws = null;
        this._subscribed = false;
    }

    connect() {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
            console.log(`Connected to ActionCable at ${this.wsUrl}`);
        });

        this.ws.on('message', (raw) => {
            let data;
            try {
                data = JSON.parse(raw.toString());
            } catch {
                console.error(`[WS] Failed to parse message: ${raw}`);
                return;
            }

            const msgType = data.type || data.type;
            console.log(`[WS RECV] msgType=${msgType} data=${JSON.stringify(data)}`);

            if (msgType === 'welcome') {
                console.log('Received welcome message. Subscribing to AgentChannel...');
                this._subscribe();
            } else if (msgType === 'confirm_subscription') {
                console.log('✅ Subscription confirmed by Rails!');
                this._subscribed = true;
                this.emit('connected');
            } else if (msgType === 'reject_subscription') {
                console.error('❌ Subscription rejected by Rails server! Check if AGENT_SECRET matches the database.');
                this.ws.close();
            } else if (msgType === 'ping') {
                // ActionCable keep-alive ping, ignore
            } else if (data.message) {
                this._handleInstruction(data.message);
            }
        });

        this.ws.on('close', () => {
            console.log('WebSocket Connection Closed.');
            this._subscribed = false;
            this.emit('close');
        });

        this.ws.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                console.error(`Connection refused at ${this.wsUrl}. Is the Rails server running?`);
            } else {
                console.error(`WebSocket Error: ${err.message}`);
            }
        });
    }

    _subscribe() {
        const identifier = JSON.stringify(this._getChannelIdentifier());
        this.ws.send(JSON.stringify({
            command: 'subscribe',
            identifier: identifier
        }));
    }

    _getChannelIdentifier() {
        return {
            channel: "AgentChannel",
            agent_secret: this.agentSecret
        };
    }

    sendAction(action, data = {}) {
        if (!this._subscribed) {
            console.warn(`Cannot send action '${action}': not subscribed`);
            return;
        }
        const identifier = JSON.stringify(this._getChannelIdentifier());
        const payload = {
            command: 'message',
            identifier: identifier,
            data: JSON.stringify({ action, ...data })
        };
        console.log(`[WS SEND] action=${action} data=${JSON.stringify(data)}`);
        this.ws.send(JSON.stringify(payload));
    }

    sendPing() {
        this.sendAction(OutboundAction.PING);
    }

    sendAuthStatus(status) {
        this.sendAction(OutboundAction.AUTH_STATUS, { status });
    }

    sendAuthUrlGenerated(url) {
        this.sendAction(OutboundAction.AUTH_URL_GENERATED, { url });
    }

    sendAuthSuccess() {
        this.sendAction(OutboundAction.AUTH_SUCCESS);
    }

    sendChatMessageIn(text) {
        this.sendAction(OutboundAction.CHAT_MESSAGE_IN, { text });
    }

    sendError(message) {
        this.sendAction(OutboundAction.ERROR, { message });
    }

    _handleInstruction(payload) {
        console.log(`[INSTRUCTION] ${JSON.stringify(payload)}`);

        if (payload.action === 'initiate_auth') {
            this.emit('initiate_auth');
        } else if (payload.action === 'submit_auth_code') {
            this.emit('submit_auth_code', payload.code);
        } else if (payload.action === 'cancel_auth') {
            this.emit('cancel_auth');
        } else if (payload.action === 'reauthenticate') {
            this.emit('reauthenticate');
        } else if (payload.action === 'check_auth_status') {
            this.emit('check_auth_status');
        } else if (payload.action === 'send_chat_message') {
            this.emit('send_chat_message', payload.text);
        } else {
            console.warn(`Unknown instruction: ${JSON.stringify(payload)}`);
        }
    }
}
