import WebSocket from "ws";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { executeGeminiAuth, executeGeminiPrompt, submitGeminiAuthCode, checkGeminiAuthStatus } from "./gemini.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.resolve(__dirname, "../SYSTEM_PROMPT.md");

const getWsUrl = () => {
    return process.env.WS_URL || 'ws://localhost:8080/cable';
};

const getChannelIdentifier = () => {
    if (!process.env.PLAYGROUND_ID || !process.env.AGENT_SECRET) {
        console.warn("⚠️ Warning: PLAYGROUND_ID or AGENT_SECRET is not set in environment! Agent will fail to authenticate with the Rails server.");
    }
    return {
        channel: "AuthChannel",
        id: process.env.PLAYGROUND_ID,
        agent_secret: process.env.AGENT_SECRET
    };
};

export const createActionCableConsumer = () => {
    const wsUrl = getWsUrl();
    console.log(`Connecting to WS_URL: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);

    let isAuthenticated = false;
    let isProcessing = false;
    let heartbeatInterval = null;

    ws.on('open', () => {
        console.log(`Connected to ActionCable at ${wsUrl}`);
    });

    const sendAction = (action, payload) => {
        const messagePayload = {
            command: "message",
            identifier: JSON.stringify(getChannelIdentifier()),
            data: JSON.stringify({ action, ...payload })
        };
        console.log(`[WS SEND] action=${action} payload=${JSON.stringify(payload)}`);
        ws.send(JSON.stringify(messagePayload));
    };

    const mockAuthChannel = {
        send: (payload) => {
            if (payload.action === 'auth_success' && payload.status === 'completed') {
                isAuthenticated = true;
            }
            sendAction(payload.action, payload);
        }
    };

    ws.on('message', async (data) => {
        let message;
        try {
            message = JSON.parse(data.toString());
            // Ignore ping messages to reduce noise
            if (message.type !== "ping") {
                console.log(`[WS RECV] msgType=${message.type || 'data'} data=${JSON.stringify(message.message || message)}`);
            }
        } catch {
            console.error(`[WS RECV ERROR] Received invalid JSON over websocket: ${data.toString()}`);
            return;
        }

        if (message.type === "welcome") {
            console.log("Received welcome message. Subscribing to AuthChannel...");
            ws.send(JSON.stringify({
                command: "subscribe",
                identifier: JSON.stringify(getChannelIdentifier())
            }));
        } else if (message.type === "confirm_subscription") {
            console.log("Subscription confirmed! Waiting for instructions...");

            // 1. Immediately send initial known statuses so the UI updates right away
            mockAuthChannel.send({ action: 'STATUS_RESPONSE', status: isProcessing ? 'BLOCKED' : 'WAITING' });
            mockAuthChannel.send({ action: 'AUTH_STATUS_RESPONSE', status: isAuthenticated ? 'READY' : 'NEED_AUTH' });

            // 2. Check initial auth status (takes ~1-2 seconds)
            isAuthenticated = await checkGeminiAuthStatus();

            // 3. Send updated auth status if it changed
            mockAuthChannel.send({ action: 'AUTH_STATUS_RESPONSE', status: isAuthenticated ? 'READY' : 'NEED_AUTH' });

            // 4. Set up heartbeat to keep Rails updated
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            heartbeatInterval = setInterval(() => {
                mockAuthChannel.send({ action: 'STATUS_RESPONSE', status: isProcessing ? 'BLOCKED' : 'WAITING' });
                mockAuthChannel.send({ action: 'AUTH_STATUS_RESPONSE', status: isAuthenticated ? 'READY' : 'NEED_AUTH' });
            }, 30000); // 30 seconds

        } else if (message.type === "reject_subscription") {
            console.error("❌ Subscription rejected by Rails server! Check if PLAYGROUND_ID and AGENT_SECRET match the database.");
            ws.close();
        } else if (message.message) {
            const payload = message.message;
            if (payload.type === 'STATUS' || payload.status) {
                mockAuthChannel.send({ action: 'STATUS_RESPONSE', status: isProcessing ? 'BLOCKED' : 'WAITING' });
            } else if (payload.type === 'AUTH_STATUS' || payload.auth_status) {
                mockAuthChannel.send({ action: 'AUTH_STATUS_RESPONSE', status: isAuthenticated ? 'READY' : 'NEED_AUTH' });
            } else if (payload.check_status) {
                mockAuthChannel.send({ action: 'STATUS_RESPONSE', status: isProcessing ? 'BLOCKED' : 'WAITING' });
                mockAuthChannel.send({ action: 'AUTH_STATUS_RESPONSE', status: isAuthenticated ? 'READY' : 'NEED_AUTH' });
            } else if (payload.start_auth) {
                console.log("Received start_auth instruction! Checking auth status...");
                const currentlyAuthenticated = await checkGeminiAuthStatus();
                if (currentlyAuthenticated) {
                    console.log("Already authenticated! Sending auth_success immediately...");
                    isAuthenticated = true;
                    mockAuthChannel.send({ action: 'auth_success', status: 'completed' });
                } else {
                    console.log("Not authenticated. Executing Gemini Auth...");
                    executeGeminiAuth(mockAuthChannel);
                }
            } else if (payload.auth_code) {
                console.log(`Received auth_code. Submitting to Gemini process...`);
                submitGeminiAuthCode(payload.auth_code);
            } else if (payload.prompt) {
                if (!isAuthenticated) {
                    console.log(`Prompt rejected: NEED_AUTH`);
                    mockAuthChannel.send({ action: 'prompt_failed', error: 'NEED_AUTH' });
                    return;
                }
                if (isProcessing) {
                    console.log(`Prompt rejected: BLOCKED`);
                    mockAuthChannel.send({ action: 'prompt_failed', error: 'BLOCKED' });
                    return;
                }
                console.log(`Received prompt. Executing Gemini...`);
                isProcessing = true;

                try {
                    const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
                    const fullPrompt = `${systemPrompt}\n\n${payload.prompt}`;
                    await handlePrompt(fullPrompt, mockAuthChannel);
                } catch (err) {
                    mockAuthChannel.send({ action: 'prompt_failed', error: err.message });
                } finally {
                    isProcessing = false;
                }
            }
        }
    });

    ws.on('close', () => {
        console.log("WebSocket Connection Closed.");
        if (heartbeatInterval) clearInterval(heartbeatInterval);
    });

    ws.on('error', (err) => {
        console.error("WebSocket Error: ", err);
    });

    return ws;
};

// Auth callback handled via direct stdin to the gemini process

const handlePrompt = async (prompt, mockAuthChannel) => {
    try {
        const result = await executeGeminiPrompt(prompt);
        mockAuthChannel.send({ action: 'prompt_completed', result });
    } catch (error) {
        mockAuthChannel.send({ action: 'prompt_failed', error: error.message });
    }
};
