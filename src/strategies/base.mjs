export class BaseStrategy {
    executeAuth(_connection) {
        throw new Error('Not implemented');
    }

    submitAuthCode(_code) {
        throw new Error('Not implemented');
    }

    cancelAuth() {
        throw new Error('Not implemented');
    }

    clearCredentials() {
        throw new Error('Not implemented');
    }

    checkAuthStatus() {
        throw new Error('Not implemented');
    }

    executePrompt(_prompt) {
        throw new Error('Not implemented');
    }
}
