import { BaseStrategy } from "./base.mjs";

export class MockStrategy extends BaseStrategy {
    executeAuth(connection) {
        console.log("[MOCK] executeAuth: Mocking auth success in 1s");
        setTimeout(() => {
            connection.sendAuthSuccess();
        }, 1000);
    }

    submitAuthCode(code) {
        console.log(`[MOCK] submitAuthCode called with code: ${code}`);
    }

    cancelAuth() {
        console.log("[MOCK] cancelAuth: No-op");
    }

    clearCredentials() {
        console.log("[MOCK] clearCredentials: Skipping credential deletion");
    }

    checkAuthStatus() {
        console.log("[MOCK] checkAuthStatus: Returning true");
        return Promise.resolve(true);
    }

    executePrompt(prompt) {
        console.log(`[MOCK] executePrompt: Mocking prompt execution for: ${prompt.substring(0, 50)}...`);
        return new Promise((resolve) => {
            setTimeout(() => {
                const timestamp = new Date().toISOString();
                resolve(`[MOCKED RESPONSE] Hello! The current timestamp is ${timestamp}`);
            }, 1000);
        });
    }
}
