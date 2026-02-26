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

    executeLogout(connection) {
        console.log("[MOCK] executeLogout: Mocking logout in 500ms");
        connection.sendLogoutOutput("Logging out (mock)...\n");
        setTimeout(() => {
            connection.sendLogoutSuccess();
        }, 500);
    }

    checkAuthStatus() {
        console.log("[MOCK] checkAuthStatus: Returning true");
        return Promise.resolve(true);
    }

    executePromptStreaming(_prompt, _model, onChunk) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const timestamp = new Date().toISOString();
                onChunk(`[MOCKED RESPONSE] Hello! `);
                onChunk(`The current timestamp is ${timestamp}`);
                resolve();
            }, 1000);
        });
    }
}
