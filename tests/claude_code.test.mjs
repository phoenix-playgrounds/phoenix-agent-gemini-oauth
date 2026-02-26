import { jest } from "@jest/globals";

const mockSpawn = jest.fn();
const mockExistsSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockRmSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();

jest.unstable_mockModule("child_process", () => ({
    spawn: mockSpawn
}));

jest.unstable_mockModule("fs", () => ({
    default: {
        existsSync: mockExistsSync,
        readdirSync: mockReaddirSync,
        mkdirSync: mockMkdirSync,
        rmSync: mockRmSync,
        readFileSync: mockReadFileSync,
        writeFileSync: mockWriteFileSync
    },
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync
}));

const { ClaudeCodeStrategy } = await import("../src/strategies/claude_code.mjs");

const mockChannel = {
    sendAction: jest.fn(),
    sendAuthSuccess: jest.fn(),
    sendAuthUrlGenerated: jest.fn(),
    sendAuthManualToken: jest.fn(),
    sendAuthStatus: jest.fn(),
    sendLogoutSuccess: jest.fn(),
    sendLogoutOutput: jest.fn(),
    sendError: jest.fn(),
    sendDeviceCode: jest.fn()
};

describe("ClaudeCodeStrategy", () => {
    let strategy;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
        strategy = new ClaudeCodeStrategy();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe("executeAuth", () => {
        it("sends auth manual token signal immediately", () => {
            strategy.executeAuth(mockChannel);
            expect(mockChannel.sendAuthManualToken).toHaveBeenCalled();
        });
    });

    describe("submitAuthCode", () => {
        it("writes valid token to disk and sends auth success", () => {
            mockExistsSync.mockReturnValue(false); // dir doesn't exist
            strategy.executeAuth(mockChannel);
            strategy.submitAuthCode(" valid-token-123 ");

            expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('.claude'), { recursive: true });
            expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining('agent_token.txt'), "valid-token-123", { mode: 0o600 });
            expect(mockChannel.sendAuthSuccess).toHaveBeenCalled();
        });

        it("warns on empty token", () => {
            strategy.executeAuth(mockChannel);
            strategy.submitAuthCode("   ");
            expect(mockWriteFileSync).not.toHaveBeenCalled();
            expect(mockChannel.sendAuthStatus).toHaveBeenCalledWith('unauthenticated');
        });
    });

    describe("executePromptStreaming", () => {
        it("does not include --continue on first call but sets CLAUDE_CODE_OAUTH_TOKEN", async () => {
            const callbacks = {};
            const mockProcess = {
                stdout: { on: jest.fn((event, cb) => { if (event === 'data') callbacks.stdout = cb; }) },
                stderr: { on: jest.fn() },
                on: (event, cb) => { callbacks[event] = cb; },
                stdin: { end: jest.fn() }
            };

            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue('saved-token');
            mockReaddirSync.mockReturnValue([]);
            mockSpawn.mockReturnValue(mockProcess);

            const onChunk = jest.fn();
            const promise = strategy.executePromptStreaming("test prompt", null, onChunk);

            const callArgs = mockSpawn.mock.calls[0][1];
            const callEnv = mockSpawn.mock.calls[0][2].env;
            expect(callArgs).toContain("-p");
            expect(callArgs).not.toContain("--continue");
            expect(callEnv.CLAUDE_CODE_OAUTH_TOKEN).toEqual('saved-token');

            callbacks.stdout(Buffer.from("resp"));
            expect(onChunk).toHaveBeenCalledWith("resp");

            callbacks.close(0);
            await promise;
        });
    });

    describe("checkAuthStatus", () => {
        let callbacks, mockProcess;
        beforeEach(() => {
            callbacks = {};
            mockProcess = {
                stdout: { on: jest.fn((e, cb) => { if (e === 'data') callbacks.stdout = cb; }) },
                stderr: { on: jest.fn() },
                kill: jest.fn(),
                on: (event, cb) => { callbacks[event] = cb; },
                stdin: { end: jest.fn() }
            };
            mockSpawn.mockReturnValue(mockProcess);
        });

        it("resolves false immediately if no token file exists", async () => {
            mockExistsSync.mockReturnValue(false);
            const p = strategy.checkAuthStatus();
            await expect(p).resolves.toBe(false);
            expect(mockSpawn).not.toHaveBeenCalled();
        });

        it("resolves true when loggedIn is true for valid token", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue('saved-token');
            const p = strategy.checkAuthStatus();

            expect(mockSpawn).toHaveBeenCalledWith("claude", ["auth", "status"], expect.objectContaining({
                env: expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: 'saved-token' })
            }));

            if (callbacks.stdout) callbacks.stdout(Buffer.from('{"loggedIn":true}'));
            if (callbacks.close) callbacks.close(0);
            await expect(p).resolves.toBe(true);
        });

        it("resolves false when loggedIn is false", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue('saved-token');
            const p = strategy.checkAuthStatus();
            if (callbacks.stdout) callbacks.stdout(Buffer.from('{"loggedIn":false}'));
            if (callbacks.close) callbacks.close(0);
            await expect(p).resolves.toBe(false);
        });

        it("resolves false on timeout", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue('saved-token');
            const p = strategy.checkAuthStatus();
            jest.advanceTimersByTime(11000);
            expect(mockProcess.kill).toHaveBeenCalled();
            await expect(p).resolves.toBe(false);
        });
    });

    describe("executeLogout", () => {
        let callbacks, mockProcess;
        beforeEach(() => {
            callbacks = {};
            mockProcess = {
                stdout: { on: jest.fn((e, cb) => { if (e === 'data') callbacks.stdout = cb; }) },
                stderr: { on: jest.fn() },
                on: (event, cb) => { callbacks[event] = cb; },
                stdin: { end: jest.fn() }
            };
            mockSpawn.mockReturnValue(mockProcess);
        });

        it("spawns logout with token env injected", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue('logout-token');

            const p = strategy.executeLogout(mockChannel);
            expect(mockSpawn).toHaveBeenCalledWith("claude", ["auth", "logout"], expect.objectContaining({
                env: expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: 'logout-token' })
            }));

            if (callbacks.stdout) callbacks.stdout(Buffer.from("Logged out"));
            if (callbacks.close) callbacks.close(0);
            await p;
            expect(mockChannel.sendLogoutOutput).toHaveBeenCalledWith("Logged out");
        });
    });

    describe("clearCredentials", () => {
        it("removes token file if exists", () => {
            mockExistsSync.mockReturnValue(true);
            strategy.clearCredentials();
            expect(mockRmSync).toHaveBeenCalledWith(expect.stringContaining('agent_token.txt'), { force: true });
        });
    });
});
