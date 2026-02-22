import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveStrategy } from "./strategies/index.mjs";
import { AgentConnection } from "./agent_connection.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.resolve(__dirname, "../SYSTEM_PROMPT.md");

const PING_INTERVAL_MS = 15_000;

export const createActionCableConsumer = () => {
    const connection = new AgentConnection();
    const strategy = resolveStrategy();

    let isAuthenticated = false;
    let isProcessing = false;
    let pingInterval = null;

    connection.on('connected', async () => {
        isAuthenticated = await strategy.checkAuthStatus();
        connection.sendAuthStatus(isAuthenticated ? 'authenticated' : 'unauthenticated');

        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            connection.sendPing();
        }, PING_INTERVAL_MS);
    });

    connection.on('check_auth_status', async () => {
        isAuthenticated = await strategy.checkAuthStatus();
        connection.sendAuthStatus(isAuthenticated ? 'authenticated' : 'unauthenticated');
    });

    connection.on('initiate_auth', async () => {
        console.log("Received initiate_auth. Checking auth status...");
        const currentlyAuthenticated = await strategy.checkAuthStatus();
        if (currentlyAuthenticated) {
            console.log("Already authenticated! Sending auth_success...");
            isAuthenticated = true;
            connection.sendAuthSuccess();
        } else {
            console.log("Not authenticated. Starting auth...");
            strategy.executeAuth(connection);
        }
    });

    connection.on('submit_auth_code', (code) => {
        console.log("Received submit_auth_code. Submitting to auth process...");
        strategy.submitAuthCode(code);
    });

    connection.on('cancel_auth', () => {
        console.log("Received cancel_auth. Terminating auth sub-process...");
        strategy.cancelAuth();
        isAuthenticated = false;
        connection.sendAuthStatus('unauthenticated');
    });

    connection.on('reauthenticate', async () => {
        console.log("Received reauthenticate. Clearing credentials and restarting auth...");
        strategy.cancelAuth();
        strategy.clearCredentials();
        isAuthenticated = false;
        connection.sendAuthStatus('unauthenticated');
        strategy.executeAuth(connection);
    });

    connection.on('send_chat_message', async (text) => {
        if (!isAuthenticated) {
            console.log("Chat message rejected: NEED_AUTH");
            connection.sendError('NEED_AUTH');
            return;
        }
        if (isProcessing) {
            console.log("Chat message rejected: BLOCKED");
            connection.sendError('BLOCKED');
            return;
        }
        console.log("Received chat message. Executing prompt...");
        isProcessing = true;

        try {
            const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
            const fullPrompt = `${systemPrompt}\n\n${text}`;

            const result = await strategy.executePrompt(fullPrompt);
            connection.sendChatMessageIn(result);
        } catch (err) {
            connection.sendError(err.message);
        } finally {
            isProcessing = false;
        }
    });

    connection.on('close', () => {
        if (pingInterval) clearInterval(pingInterval);
    });

    connection.connect();

    return connection.ws;
};
