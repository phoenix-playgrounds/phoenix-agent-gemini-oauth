import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import http from "http";
import { BaseStrategy } from "./base.mjs";

const ANSI_REGEX = /\x1B(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07)/g;
const CLAUDE_AUTH_URL_REGEX = /https:\/\/claude\.ai\/oauth[^\s"'>)]+/;
const CALLBACK_PORT_REGEX = /redirect_uri=http%3A%2F%2Flocalhost%3A(\d+)/;
const DEFAULT_CALLBACK_PORT = 8765;
const PLAYGROUND_DIR = path.resolve(process.cwd(), 'playground');
const CLAUDE_CONFIG_DIR = path.join(process.env.HOME || '/home/node', '.claude');

export class ClaudeCodeStrategy extends BaseStrategy {
    constructor() {
        super();
        this.activeAuthProcess = null;
        this.currentConnection = null;
        this.callbackPort = null;
        this._hasSession = false;
    }

    executeAuth(connection) {
        this.currentConnection = connection;

        this.activeAuthProcess = spawn('claude', [], {
            env: { ...process.env, BROWSER: '/bin/true', DISPLAY: '' },
            shell: false
        });

        let authUrlExtracted = false;

        const handleCliOutput = (data) => {
            const output = data.toString().replace(ANSI_REGEX, '');
            if (output.trim()) {
                console.log(`[CLAUDE RAW OUTPUT]: ${output.trim()}`);
            }

            const urlMatch = output.match(CLAUDE_AUTH_URL_REGEX);

            if (urlMatch && !authUrlExtracted) {
                authUrlExtracted = true;
                const authUrl = urlMatch[0];

                const portMatch = authUrl.match(CALLBACK_PORT_REGEX);
                if (portMatch) {
                    this.callbackPort = parseInt(portMatch[1]);
                }

                if (this.currentConnection) {
                    this.currentConnection.sendAuthUrlGenerated(authUrl);
                }
            }
        };

        this.activeAuthProcess.stdout.on('data', handleCliOutput);
        this.activeAuthProcess.stderr.on('data', handleCliOutput);

        this.activeAuthProcess.on('close', (code) => {
            console.log(`Claude Auth Process exited with code ${code}`);
            if (this.currentConnection) {
                if (code === 0) {
                    this.currentConnection.sendAuthSuccess();
                } else {
                    console.error(`Claude Auth failed with exit code ${code}`);
                    this.currentConnection.sendAuthStatus('unauthenticated');
                }
            }
            this.activeAuthProcess = null;
            this.currentConnection = null;
        });

        this.activeAuthProcess.on('error', (err) => {
            console.error('Claude Auth Process error:', err);
        });
    }

    submitAuthCode(input) {
        const callbackUrl = this._buildCallbackUrl(input);

        console.log(`Forwarding callback to Claude CLI local server: ${callbackUrl}`);

        http.get(callbackUrl, (res) => {
            res.on('data', () => { });
            res.on('end', () => {
                console.log(`Claude callback response: ${res.statusCode}`);
            });
        }).on('error', (err) => {
            console.error(`Error forwarding callback to Claude CLI: ${err.message}`);
        });
    }

    _buildCallbackUrl(input) {
        if (input.startsWith('http://localhost')) {
            return input;
        }

        const port = this.callbackPort || DEFAULT_CALLBACK_PORT;

        if (input.startsWith('?')) {
            return `http://localhost:${port}/callback${input}`;
        }

        return `http://localhost:${port}/callback?code=${encodeURIComponent(input)}`;
    }

    cancelAuth() {
        if (this.activeAuthProcess) {
            console.log("Cancelling Claude Auth process...");
            this.activeAuthProcess.kill();
            this.activeAuthProcess = null;
            this.currentConnection = null;
        }
    }

    clearCredentials() {
        if (fs.existsSync(CLAUDE_CONFIG_DIR)) {
            console.log(`Deleting Claude config directory: ${CLAUDE_CONFIG_DIR}`);
            fs.rmSync(CLAUDE_CONFIG_DIR, { recursive: true, force: true });
        }
        console.log("Claude credentials cleared.");
    }

    checkAuthStatus() {
        return new Promise((resolve) => {
            const checkProcess = spawn('claude', ['-p', '', '--dangerously-skip-permissions'], {
                env: { ...process.env, BROWSER: '/bin/true', DISPLAY: '' },
                shell: false
            });

            let outputStr = '';
            let resolved = false;

            const handleData = (data) => {
                if (resolved) return;
                const text = data.toString().replace(ANSI_REGEX, '');
                outputStr += text;

                if (CLAUDE_AUTH_URL_REGEX.test(outputStr)) {
                    resolved = true;
                    checkProcess.kill();
                    resolve(false);
                }
            };

            checkProcess.stdout.on('data', handleData);
            checkProcess.stderr.on('data', handleData);

            checkProcess.on('close', (code) => {
                if (!resolved) {
                    resolved = true;
                    resolve(code === 0);
                }
            });

            checkProcess.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    console.error("Error checking Claude auth status:", err);
                    resolve(false);
                }
            });
        });
    }

    executePromptStreaming(prompt, _model, onChunk) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(PLAYGROUND_DIR)) {
                fs.mkdirSync(PLAYGROUND_DIR, { recursive: true });
            }

            const args = [
                ...(this._hasSession ? ['--continue'] : []),
                '-p', prompt, '--dangerously-skip-permissions'
            ];

            for (const dir of this._getPlaygroundDirs()) {
                args.push('--add-dir', dir);
            }

            const claudeProcess = spawn('claude', args, {
                env: { ...process.env, BROWSER: '/bin/true', DISPLAY: '' },
                cwd: PLAYGROUND_DIR,
                shell: false
            });

            let errorResult = '';

            claudeProcess.stdout.on('data', (data) => {
                onChunk(data.toString());
            });

            claudeProcess.stderr.on('data', (data) => {
                errorResult += data.toString();
            });

            claudeProcess.on('close', (code) => {
                if (code !== 0) {
                    console.warn(`Claude process exited with code ${code}`);
                }
                if (code !== 0 && errorResult.trim()) {
                    reject(new Error(errorResult || `Process exited with code ${code}`));
                } else {
                    this._hasSession = true;
                    resolve();
                }
            });

            claudeProcess.on('error', (err) => {
                reject(err);
            });
        });
    }

    _getPlaygroundDirs() {
        try {
            if (!fs.existsSync(PLAYGROUND_DIR)) return [];
            return fs.readdirSync(PLAYGROUND_DIR, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => path.join(PLAYGROUND_DIR, entry.name));
        } catch {
            return [];
        }
    }
}
