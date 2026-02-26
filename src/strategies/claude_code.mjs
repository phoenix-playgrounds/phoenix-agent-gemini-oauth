import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { BaseStrategy } from "./base.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLAUDE_CONFIG_DIR = path.join(process.env.HOME || '/home/node', '.claude');
const TOKEN_FILE_PATH = path.join(CLAUDE_CONFIG_DIR, 'agent_token.txt');
const PLAYGROUND_DIR = path.resolve(process.cwd(), 'playground');

export class ClaudeCodeStrategy extends BaseStrategy {
    constructor() {
        super();
        this.currentConnection = null;
        this._hasSession = false;
    }

    _getToken() {
        if (fs.existsSync(TOKEN_FILE_PATH)) {
            return fs.readFileSync(TOKEN_FILE_PATH, 'utf8').trim();
        }
        return null;
    }

    executeAuth(connection) {
        this.currentConnection = connection;
        connection.sendAuthManualToken();
    }

    submitAuthCode(code) {
        const trimmed = (code || '').trim();
        if (trimmed) {
            if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
                fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
            }
            fs.writeFileSync(TOKEN_FILE_PATH, trimmed, { mode: 0o600 });
            console.log(`[CLAUDE] Token saved manually`);
            if (this.currentConnection) {
                this.currentConnection.sendAuthSuccess();
            }
            this._hasSession = true;
        } else {
            console.error('[CLAUDE AUTH] Empty token submitted.');
            if (this.currentConnection) {
                this.currentConnection.sendAuthStatus('unauthenticated');
            }
        }
    }

    cancelAuth() {
        this.currentConnection = null;
    }

    clearCredentials() {
        if (fs.existsSync(TOKEN_FILE_PATH)) {
            console.log(`Deleting Claude token file: ${TOKEN_FILE_PATH}`);
            fs.rmSync(TOKEN_FILE_PATH, { force: true });
        }
        console.log("Claude credentials cleared.");
    }

    executeLogout(connection) {
        const token = this._getToken();
        const logoutProcess = spawn('claude', ['auth', 'logout'], {
            env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token || '' },
            shell: false
        });
        logoutProcess.stdin.end();

        const handleOutput = (data) => {
            const text = data.toString();
            console.log(`[CLAUDE LOGOUT]: ${text.trim()} `);
            connection.sendLogoutOutput(text);
        };

        logoutProcess.stdout.on('data', handleOutput);
        logoutProcess.stderr.on('data', handleOutput);

        logoutProcess.on('close', (code) => {
            console.log(`[CLAUDE] logout exited with code ${code} `);
            this._hasSession = false;
            connection.sendLogoutSuccess();
        });

        logoutProcess.on('error', (err) => {
            console.error('[CLAUDE LOGOUT ERROR]:', err);
            this._hasSession = false;
            connection.sendLogoutSuccess();
        });
    }

    checkAuthStatus() {
        const AUTH_STATUS_TIMEOUT_MS = 10_000;

        return new Promise((resolve) => {
            const token = this._getToken();
            if (!token) {
                resolve(false);
                return;
            }

            const checkProcess = spawn('claude', ['auth', 'status'], {
                env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
                shell: false
            });
            checkProcess.stdin.end();

            let outputStr = '';
            let resolved = false;

            const finish = (result) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                resolve(result);
            };

            const timer = setTimeout(() => {
                console.error('Claude auth status check timed out');
                checkProcess.kill();
                finish(false);
            }, AUTH_STATUS_TIMEOUT_MS);

            checkProcess.stdout.on('data', (data) => {
                outputStr += data.toString();
            });

            checkProcess.stderr.on('data', (data) => {
                console.error(`[CLAUDE AUTH STATUS STDERR]: ${data.toString().trim()} `);
            });

            checkProcess.on('close', (code) => {
                if (code !== 0) {
                    finish(false);
                    return;
                }
                try {
                    const status = JSON.parse(outputStr);
                    finish(status.loggedIn === true);
                } catch {
                    console.error('Failed to parse claude auth status output');
                    finish(false);
                }
            });

            checkProcess.on('error', (err) => {
                console.error('Error checking Claude auth status:', err);
                finish(false);
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

            const token = this._getToken();
            const claudeProcess = spawn('claude', args, {
                env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token || '', BROWSER: '/bin/true', DISPLAY: '' },
                cwd: PLAYGROUND_DIR,
                shell: false
            });
            claudeProcess.stdin.end();

            let errorResult = '';

            claudeProcess.stdout.on('data', (data) => {
                onChunk(data.toString());
            });

            claudeProcess.stderr.on('data', (data) => {
                errorResult += data.toString();
            });

            claudeProcess.on('close', (code) => {
                if (code !== 0) {
                    console.warn(`Claude process exited with code ${code} `);
                }
                if (code !== 0 && errorResult.trim()) {
                    reject(new Error(errorResult || `Process exited with code ${code} `));
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
