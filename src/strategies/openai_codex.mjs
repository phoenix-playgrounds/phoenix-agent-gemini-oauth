import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { BaseStrategy } from "./base.mjs";

const CODEX_CONFIG_DIR = path.join(process.env.HOME || '/home/node', '.codex');
const CODEX_AUTH_FILE = path.join(CODEX_CONFIG_DIR, 'auth.json');

export class OpenaiCodexStrategy extends BaseStrategy {
    constructor() {
        super();
        this.activeAuthProcess = null;
        this.currentConnection = null;
        this._hasSession = false;
    }

    executeAuth(connection) {
        this.currentConnection = connection;

        this.activeAuthProcess = spawn('codex', ['login', '--device-auth'], {
            env: { ...process.env },
            shell: false
        });

        let authUrlExtracted = false;

        const handleCliOutput = (data) => {
            const output = data.toString();
            console.log(`[CODEX RAW OUTPUT]: ${output.trim()}`);

            const urlMatch = output.match(/https:\/\/[^\s"'>]+/);

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
            console.log(`Codex Auth Process exited with code ${code}`);
            if (this.currentConnection) {
                if (code === 0) {
                    this.currentConnection.sendAuthSuccess();
                } else {
                    console.error(`Codex Auth failed with exit code ${code}`);
                    this.currentConnection.sendAuthStatus('unauthenticated');
                }
            }
            this.activeAuthProcess = null;
            this.currentConnection = null;
        });

        this.activeAuthProcess.on('error', (err) => {
            console.error('Codex Auth Process error:', err);
        });
    }

    cancelAuth() {
        if (this.activeAuthProcess) {
            console.log("Cancelling Codex Auth process...");
            this.activeAuthProcess.kill();
            this.activeAuthProcess = null;
            this.currentConnection = null;
        }
    }

    submitAuthCode(code) {
        if (this.activeAuthProcess && this.activeAuthProcess.stdin) {
            console.log("Writing auth code to Codex process...");
            this.activeAuthProcess.stdin.write((code || '').trim() + '\n');
        } else {
            console.error("No active Codex authentication process found to submit code to.");
        }
    }

    clearCredentials() {
        if (fs.existsSync(CODEX_AUTH_FILE)) {
            console.log(`Deleting credential file: ${CODEX_AUTH_FILE}`);
            fs.unlinkSync(CODEX_AUTH_FILE);
        }
        console.log("Codex credentials cleared.");
    }

    checkAuthStatus() {
        return new Promise((resolve) => {
            if (fs.existsSync(CODEX_AUTH_FILE)) {
                try {
                    const content = fs.readFileSync(CODEX_AUTH_FILE, 'utf8');
                    const auth = JSON.parse(content);
                    if (auth && (auth.access_token || auth.token || auth.api_key)) {
                        resolve(true);
                        return;
                    }
                } catch (err) {
                    console.error("Error reading Codex auth file:", err);
                }
            }
            resolve(false);
        });
    }

    executePromptStreaming(prompt, _model, onChunk) {
        return new Promise((resolve, reject) => {
            const playgroundDir = path.resolve(process.cwd(), 'playground');
            if (!fs.existsSync(playgroundDir)) {
                fs.mkdirSync(playgroundDir, { recursive: true });
            }

            const codexArgs = this._hasSession
                ? ['exec', 'resume', '--last', '--yolo', prompt]
                : ['exec', '--yolo', prompt];

            const codexProcess = spawn('codex', codexArgs, {
                env: { ...process.env },
                cwd: playgroundDir,
                shell: false
            });

            let errorResult = '';

            codexProcess.stdout.on('data', (data) => {
                onChunk(data.toString());
            });

            codexProcess.stderr.on('data', (data) => {
                errorResult += data.toString();
            });

            codexProcess.on('close', (code) => {
                if (code !== 0) {
                    console.warn(`Codex process exited with code ${code}`);
                }
                if (code !== 0 && errorResult.trim()) {
                    reject(new Error(errorResult || `Process exited with code ${code}`));
                } else {
                    this._hasSession = true;
                    resolve();
                }
            });

            codexProcess.on('error', (err) => {
                reject(err);
            });
        });
    }
}
