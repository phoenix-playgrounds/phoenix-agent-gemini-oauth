import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { BaseStrategy } from "./base.mjs";

const GEMINI_CONFIG_DIR = path.join(process.env.HOME || '/home/node', '.gemini');

export class GeminiStrategy extends BaseStrategy {
    constructor() {
        super();
        this.activeAuthProcess = null;
        this.currentConnection = null;
    }

    executeAuth(connection) {
        this.currentConnection = connection;

        // gemini login is removed in 0.29+, positional args are prompts.
        // passing an empty prompt will trigger auth if unauthenticated, or just exit quickly.
        this.activeAuthProcess = spawn('gemini', [''], {
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
                if (this.currentConnection) {
                    this.currentConnection.sendAuthUrlGenerated(authUrl);
                }
            }
        };

        this.activeAuthProcess.stdout.on('data', handleCliOutput);
        this.activeAuthProcess.stderr.on('data', handleCliOutput);

        this.activeAuthProcess.on('close', (code) => {
            console.log(`Gemini Auth Process exited with code ${code}`);
            if (this.currentConnection) {
                if (code === 0 || code === 42) {
                    this.currentConnection.sendAuthSuccess();
                } else {
                    console.error(`Gemini Auth failed with exit code ${code}`);
                    this.currentConnection.sendAuthStatus('unauthenticated');
                }
            }
            this.activeAuthProcess = null;
            this.currentConnection = null;
        });

        this.activeAuthProcess.on('error', (err) => {
            console.error('Gemini Auth Process error:', err);
        });
    }

    cancelAuth() {
        if (this.activeAuthProcess) {
            console.log("Cancelling Gemini Auth process...");
            this.activeAuthProcess.kill();
            this.activeAuthProcess = null;
            this.currentConnection = null;
        }
    }

    submitAuthCode(code) {
        if (this.activeAuthProcess && this.activeAuthProcess.stdin) {
            console.log("Writing auth code to Gemini process...");
            this.activeAuthProcess.stdin.write((code || '').trim() + '\n');
        } else {
            console.error("No active Gemini authentication process found to submit code to.");
        }
    }

    clearCredentials() {
        const credentialFiles = ['oauth_creds.json', 'credentials.json', '.credentials.json'];

        for (const file of credentialFiles) {
            const filePath = path.join(GEMINI_CONFIG_DIR, file);
            if (fs.existsSync(filePath)) {
                console.log(`Deleting credential file: ${filePath}`);
                fs.unlinkSync(filePath);
            }
        }

        const configSubDirs = ['Configure', 'auth'];
        for (const dir of configSubDirs) {
            const dirPath = path.join(GEMINI_CONFIG_DIR, dir);
            if (fs.existsSync(dirPath)) {
                console.log(`Deleting credential directory: ${dirPath}`);
                fs.rmSync(dirPath, { recursive: true, force: true });
            }
        }

        console.log("Gemini credentials cleared.");
    }

    checkAuthStatus() {
        return new Promise((resolve) => {
            const geminiProcess = spawn('gemini', [''], {
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

            geminiProcess.on('close', (_code) => {
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
    }

    executePrompt(prompt) {
        return new Promise((resolve, reject) => {
            const playgroundDir = path.resolve(process.cwd(), 'playground');
            if (!fs.existsSync(playgroundDir)) {
                fs.mkdirSync(playgroundDir, { recursive: true });
            }

            const geminiProcess = spawn('gemini', ['--yolo', prompt], {
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
                if (code !== 0) {
                    console.warn(`Gemini process exited with code ${code}`);
                }
                if (outputResult.trim()) {
                    resolve(outputResult);
                } else if (code !== 0) {
                    reject(new Error(errorResult || `Process exited with code ${code}`));
                } else {
                    resolve(outputResult);
                }
            });

            geminiProcess.on('error', (err) => {
                reject(err);
            });
        });
    }
}
