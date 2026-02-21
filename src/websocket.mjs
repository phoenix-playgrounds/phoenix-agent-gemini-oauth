import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { executeGeminiAuth, executeGeminiPrompt, submitGeminiAuthCode, checkGeminiAuthStatus } from "./gemini.mjs";
import { AgentConnection } from "./agent_connection.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.resolve(__dirname, "../SYSTEM_PROMPT.md");

export const createActionCableConsumer = () => {
    const connection = new AgentConnection();

    let isAuthenticated = false;
    let isProcessing = false;
    let heartbeatInterval = null;

    connection.on('connected', async () => {
        // 1. Immediately send initial known statuses so the UI updates right away
        connection.sendStatusResponse(isProcessing ? 'BLOCKED' : 'WAITING');
        connection.sendAuthStatusResponse(isAuthenticated ? 'READY' : 'NEED_AUTH');

        // 2. Check initial auth status (takes ~1-2 seconds)
        isAuthenticated = await checkGeminiAuthStatus();

        // 3. Send updated auth status if it changed
        connection.sendAuthStatusResponse(isAuthenticated ? 'READY' : 'NEED_AUTH');

        // 4. Set up heartbeat to keep Rails updated
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
            connection.sendStatusResponse(isProcessing ? 'BLOCKED' : 'WAITING');
            connection.sendAuthStatusResponse(isAuthenticated ? 'READY' : 'NEED_AUTH');
        }, 30000); // 30 seconds
    });

    connection.on('request_status', () => {
        connection.sendStatusResponse(isProcessing ? 'BLOCKED' : 'WAITING');
    });

    connection.on('request_auth_status', () => {
        connection.sendAuthStatusResponse(isAuthenticated ? 'READY' : 'NEED_AUTH');
    });

    connection.on('request_full_status', () => {
        connection.sendStatusResponse(isProcessing ? 'BLOCKED' : 'WAITING');
        connection.sendAuthStatusResponse(isAuthenticated ? 'READY' : 'NEED_AUTH');
    });

    connection.on('start_auth', async () => {
        console.log("Received start_auth instruction! Checking auth status...");
        const currentlyAuthenticated = await checkGeminiAuthStatus();
        if (currentlyAuthenticated) {
            console.log("Already authenticated! Sending auth_success immediately...");
            isAuthenticated = true;
            connection.sendAuthSuccess();
        } else {
            console.log("Not authenticated. Executing Gemini Auth...");
            executeGeminiAuth(connection);
        }
    });

    connection.on('auth_code', (auth_code) => {
        console.log(`Received auth_code. Submitting to Gemini process...`);
        submitGeminiAuthCode(auth_code);
    });

    connection.on('prompt', async (promptText) => {
        if (!isAuthenticated) {
            console.log(`Prompt rejected: NEED_AUTH`);
            connection.sendPromptFailed('NEED_AUTH');
            return;
        }
        if (isProcessing) {
            console.log(`Prompt rejected: BLOCKED`);
            connection.sendPromptFailed('BLOCKED');
            return;
        }
        console.log(`Received prompt. Executing Gemini...`);
        isProcessing = true;

        try {
            const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
            const fullPrompt = `${systemPrompt}\n\n${promptText}`;

            const result = await executeGeminiPrompt(fullPrompt);
            connection.sendPromptCompleted(result);
        } catch (err) {
            connection.sendPromptFailed(err.message);
        } finally {
            isProcessing = false;
        }
    });

    connection.on('close', () => {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
    });

    connection.connect();

    return connection.ws;
};
