import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { OutboundAction } from "./agent_connection.mjs";

let activeAuthProcess = null;
let currentConnection = null;

export const executeGeminiAuth = (connection) => {
    currentConnection = connection;

    if (process.env.MOCKED_GEMINI === '1') {
        console.log("[MOCK] executeGeminiAuth: Mocking auth success in 1s");
        setTimeout(() => {
            if (currentConnection) {
                currentConnection.sendAuthSuccess();
                currentConnection = null;
            }
        }, 1000);
        return;
    }

    // gemini login is removed in 0.29+, positional args are prompts.
    // passing an empty prompt will trigger auth if unauthenticated, or just exit quickly.
    activeAuthProcess = spawn('gemini', ['-p', ''], {
        env: { ...process.env, NO_BROWSER: 'true' },
        shell: false
    });

    let authUrlExtracted = false;

    const handleCliOutput = (data) => {
        const output = data.toString();
        // Skip noisy auth loop logs
        if (!output.includes('Waiting for authentication')) {
            console.log(`[GEMINI RAW OUTPUT]: ${output.trim()}`);
        }

        const urlMatch = output.match(/https:\/\/accounts\.google\.com[^\s"'>]+/);

        if (urlMatch && !authUrlExtracted) {
            authUrlExtracted = true;
            const authUrl = urlMatch[0];
            if (currentConnection) {
                currentConnection.sendAction(OutboundAction.URL_GENERATED, { url: authUrl });
            }
        }
    };

    activeAuthProcess.stdout.on('data', handleCliOutput);
    activeAuthProcess.stderr.on('data', handleCliOutput);

    activeAuthProcess.on('close', (code) => {
        console.log(`Gemini Auth Process exited with code ${code}`);
        if (currentConnection) {
            if (code === 0 || code === 42) {
                currentConnection.sendAuthSuccess();
            } else {
                console.error(`Gemini Auth failed with exit code ${code}`);
                currentConnection.sendAuthStatusResponse('NEED_AUTH');
                currentConnection.sendStatusResponse('WAITING');
            }
        }
        activeAuthProcess = null;
        currentConnection = null;
    });

    activeAuthProcess.on('error', (err) => {
        console.error('Gemini Auth Process error:', err);
    });
};

export const cancelGeminiAuth = () => {
    if (activeAuthProcess) {
        console.log("Cancelling Gemini Auth process...");
        activeAuthProcess.kill();
        activeAuthProcess = null;
        currentConnection = null;
    }
};

export const submitGeminiAuthCode = (code) => {
    if (process.env.MOCKED_GEMINI === '1') {
        console.log(`[MOCK] submitGeminiAuthCode called with code: ${code}`);
        return;
    }

    if (activeAuthProcess && activeAuthProcess.stdin) {
        console.log("Writing auth code to Gemini process...");
        activeAuthProcess.stdin.write((code || '').trim() + '\n');
    } else {
        console.error("No active Gemini authentication process found to submit code to.");
    }
};

export const checkGeminiAuthStatus = () => {
    if (process.env.MOCKED_GEMINI === '1') {
        console.log("[MOCK] checkGeminiAuthStatus: Returning true");
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        const geminiProcess = spawn('gemini', ['-p', ''], {
            env: { ...process.env, NO_BROWSER: 'true' },
            shell: false
        });

        let outputStr = '';
        let resolved = false;

        const handleData = (data) => {
            if (resolved) return;
            const text = data.toString();
            outputStr += text;

            // If it asks for an auth URL, it's not authenticated.
            if (/https:\/\/accounts\.google\.com[^\s"'>]+/.test(outputStr) || text.includes('Waiting for authentication')) {
                resolved = true;
                geminiProcess.kill();
                resolve(false);
            }
        };

        geminiProcess.stdout.on('data', handleData);
        geminiProcess.stderr.on('data', handleData);

        geminiProcess.on('close', (code) => {
            if (!resolved) {
                resolved = true;
                resolve(true);
            }
        });

        geminiProcess.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                console.error("Error checking auth status: ", err);
                resolve(false);
            }
        });
    });
};

export const executeGeminiPrompt = (prompt) => {
    if (process.env.MOCKED_GEMINI === '1') {
        console.log(`[MOCK] executeGeminiPrompt: Mocking prompt execution for: ${prompt.substring(0, 50)}...`);
        return new Promise((resolve) => {
            setTimeout(() => {
                const timestamp = new Date().toISOString();
                resolve(`[MOCKED RESPONSE] Hello! The current timestamp is ${timestamp}`);
            }, 1000);
        });
    }

    return new Promise((resolve, reject) => {
        const playgroundDir = path.resolve(process.cwd(), 'playground');
        if (!fs.existsSync(playgroundDir)) {
            fs.mkdirSync(playgroundDir, { recursive: true });
        }

        const geminiProcess = spawn('gemini', ['--yolo', '-p', prompt], {
            env: { ...process.env, NO_BROWSER: 'true' },
            cwd: playgroundDir,
            shell: false
        });

        let outputResult = '';
        let errorResult = '';

        geminiProcess.stdout.on('data', (data) => {
            outputResult += data.toString();
        });

        geminiProcess.stderr.on('data', (data) => {
            errorResult += data.toString();
        });

        geminiProcess.on('close', (code) => {
            if (code === 0) {
                resolve(outputResult);
            } else {
                reject(new Error(errorResult || 'Process exited with non-zero code'));
            }
        });

        geminiProcess.on('error', (err) => {
            reject(err);
        });
    });
};
