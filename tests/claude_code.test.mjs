import { jest } from "@jest/globals";

const mockSpawn = jest.fn();
const mockExistsSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockRmSync = jest.fn();
const mockHttpGet = jest.fn();

jest.unstable_mockModule("child_process", () => ({
    spawn: mockSpawn
}));

jest.unstable_mockModule("fs", () => ({
    default: {
        existsSync: mockExistsSync,
        readdirSync: mockReaddirSync,
        mkdirSync: mockMkdirSync,
        rmSync: mockRmSync
    },
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync
}));

jest.unstable_mockModule("http", () => ({
    default: { get: mockHttpGet },
    get: mockHttpGet
}));

const { ClaudeCodeStrategy } = await import("../src/strategies/claude_code.mjs");

const mockChannel = {
    sendAction: jest.fn(),
    sendAuthSuccess: jest.fn(),
    sendAuthUrlGenerated: jest.fn(),
    sendAuthStatus: jest.fn()
};

describe("ClaudeCodeStrategy", () => {
    let strategy;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
        strategy = new ClaudeCodeStrategy();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("executeAuth", () => {
        it("spawns claude and captures OAuth URL", () => {
            const onStdoutData = jest.fn();
            const onStderrData = jest.fn();
            const callbacks = {};
            const mockProcess = {
                stdout: { on: onStdoutData },
                stderr: { on: onStderrData },
                on: (event, cb) => { callbacks[event] = cb; }
            };

            mockSpawn.mockReturnValue(mockProcess);

            strategy.executeAuth(mockChannel);

            expect(mockSpawn).toHaveBeenCalledWith("claude", [], expect.objectContaining({
                shell: false,
                env: expect.objectContaining({ BROWSER: '/bin/true', DISPLAY: '' })
            }));

            const stdoutCallback = onStdoutData.mock.calls[0][1];
            stdoutCallback(Buffer.from("Open this URL: https://claude.ai/oauth/authorize?client_id=abc&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcallback&response_type=code"));

            expect(mockChannel.sendAuthUrlGenerated).toHaveBeenCalledWith(
                expect.stringContaining("https://claude.ai/oauth/authorize")
            );
            expect(strategy.callbackPort).toBe(9999);
        });

        it("sends auth_success when process exits with code 0", () => {
            const callbacks = {};
            const mockProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: (event, cb) => { callbacks[event] = cb; }
            };

            mockSpawn.mockReturnValue(mockProcess);
            strategy.executeAuth(mockChannel);
            callbacks.close(0);

            expect(mockChannel.sendAuthSuccess).toHaveBeenCalled();
        });

        it("strips ANSI escape codes from output", () => {
            const onStdoutData = jest.fn();
            const callbacks = {};
            const mockProcess = {
                stdout: { on: onStdoutData },
                stderr: { on: jest.fn() },
                on: (event, cb) => { callbacks[event] = cb; }
            };

            mockSpawn.mockReturnValue(mockProcess);
            strategy.executeAuth(mockChannel);

            const stdoutCallback = onStdoutData.mock.calls[0][1];
            stdoutCallback(Buffer.from("\x1B[1mhttps://claude.ai/oauth/authorize?client_id=test\x1B[0m"));

            expect(mockChannel.sendAuthUrlGenerated).toHaveBeenCalledWith(
                "https://claude.ai/oauth/authorize?client_id=test"
            );
        });
    });

    describe("submitAuthCode", () => {
        it("forwards full redirect URL to local callback server", () => {
            const mockResponse = { on: jest.fn(), statusCode: 200 };
            mockResponse.on.mockImplementation((event, cb) => {
                if (event === 'data') cb('OK');
                if (event === 'end') cb();
            });
            mockHttpGet.mockImplementation((_url, cb) => {
                cb(mockResponse);
                return { on: jest.fn() };
            });

            strategy.submitAuthCode("http://localhost:8765/callback?code=XXX&state=YYY");

            expect(mockHttpGet).toHaveBeenCalledWith(
                "http://localhost:8765/callback?code=XXX&state=YYY",
                expect.any(Function)
            );
        });

        it("uses extracted port when input is not a full URL", () => {
            strategy.callbackPort = 9999;
            const mockResponse = { on: jest.fn(), statusCode: 200 };
            mockResponse.on.mockImplementation((event, cb) => {
                if (event === 'data') cb('OK');
                if (event === 'end') cb();
            });
            mockHttpGet.mockImplementation((_url, cb) => {
                cb(mockResponse);
                return { on: jest.fn() };
            });

            strategy.submitAuthCode("?code=XXX&state=YYY");

            expect(mockHttpGet).toHaveBeenCalledWith(
                "http://localhost:9999/callback?code=XXX&state=YYY",
                expect.any(Function)
            );
        });
    });

    describe("executePromptStreaming", () => {
        it("does not include --continue on first call", async () => {
            const onStdoutData = jest.fn();
            const onStderrData = jest.fn();
            const callbacks = {};
            const mockProcess = {
                stdout: { on: onStdoutData },
                stderr: { on: onStderrData },
                on: (event, cb) => { callbacks[event] = cb; }
            };

            mockExistsSync.mockReturnValue(true);
            mockReaddirSync.mockReturnValue([
                { name: 'repo1', isDirectory: () => true },
                { name: 'repo2', isDirectory: () => true },
                { name: 'file.txt', isDirectory: () => false }
            ]);
            mockSpawn.mockReturnValue(mockProcess);

            const onChunk = jest.fn();
            const promise = strategy.executePromptStreaming("test prompt", null, onChunk);

            const spawnArgs = mockSpawn.mock.calls[0][1];
            expect(spawnArgs[0]).toBe('-p');
            expect(spawnArgs).not.toContain('--continue');

            const stdoutCallback = onStdoutData.mock.calls[0][1];
            stdoutCallback(Buffer.from("Claude result here"));
            expect(onChunk).toHaveBeenCalledWith("Claude result here");

            callbacks.close(0);
            await promise;
        });

        it("includes --continue on subsequent calls after success", async () => {
            const createMockProcess = () => {
                const callbacks = {};
                return {
                    process: {
                        stdout: { on: jest.fn((_, cb) => { callbacks.stdout = cb; }) },
                        stderr: { on: jest.fn() },
                        on: (event, cb) => { callbacks[event] = cb; }
                    },
                    callbacks
                };
            };

            mockExistsSync.mockReturnValue(true);
            mockReaddirSync.mockReturnValue([]);

            const first = createMockProcess();
            mockSpawn.mockReturnValue(first.process);
            const p1 = strategy.executePromptStreaming("first", null, jest.fn());
            first.callbacks.stdout(Buffer.from("ok"));
            first.callbacks.close(0);
            await p1;

            const second = createMockProcess();
            mockSpawn.mockReturnValue(second.process);
            const p2 = strategy.executePromptStreaming("second", null, jest.fn());

            const secondArgs = mockSpawn.mock.calls[1][1];
            expect(secondArgs[0]).toBe('--continue');

            second.callbacks.stdout(Buffer.from("ok"));
            second.callbacks.close(0);
            await p2;
        });

        it("works with empty playground directory", async () => {
            const onStdoutData = jest.fn();
            const onStderrData = jest.fn();
            const callbacks = {};
            const mockProcess = {
                stdout: { on: onStdoutData },
                stderr: { on: onStderrData },
                on: (event, cb) => { callbacks[event] = cb; }
            };

            mockExistsSync.mockReturnValue(true);
            mockReaddirSync.mockReturnValue([]);
            mockSpawn.mockReturnValue(mockProcess);

            const onChunk = jest.fn();
            const promise = strategy.executePromptStreaming("test", null, onChunk);

            expect(mockSpawn).toHaveBeenCalledWith(
                "claude",
                ['-p', 'test', '--dangerously-skip-permissions'],
                expect.any(Object)
            );

            const stdoutCallback = onStdoutData.mock.calls[0][1];
            stdoutCallback(Buffer.from("done"));
            callbacks.close(0);

            await promise;
        });
    });

    describe("checkAuthStatus", () => {
        let callbacks, mockProcess;

        beforeEach(() => {
            callbacks = {};
            mockProcess = {
                stdout: { on: jest.fn((event, cb) => { if (event === 'data') callbacks.stdoutData = cb; }) },
                stderr: { on: jest.fn((event, cb) => { if (event === 'data') callbacks.stderrData = cb; }) },
                kill: jest.fn(),
                on: (event, cb) => { callbacks[event] = cb; }
            };
            mockSpawn.mockReturnValue(mockProcess);
        });

        it("resolves true if process exits cleanly without auth URL", async () => {
            const resultPromise = strategy.checkAuthStatus();

            if (callbacks.stdoutData) callbacks.stdoutData(Buffer.from("running fine\n"));
            if (callbacks.close) callbacks.close(0);

            await expect(resultPromise).resolves.toBe(true);
        });

        it("resolves false if auth URL is detected in output", async () => {
            const resultPromise = strategy.checkAuthStatus();

            if (callbacks.stdoutData) {
                callbacks.stdoutData(Buffer.from("https://claude.ai/oauth/authorize?client_id=abc\n"));
            }

            await expect(resultPromise).resolves.toBe(false);
        });

        it("resolves false on spawn error", async () => {
            const resultPromise = strategy.checkAuthStatus();

            if (callbacks.error) callbacks.error(new Error("enoent"));

            await expect(resultPromise).resolves.toBe(false);
        });
    });

    describe("clearCredentials", () => {
        it("removes ~/.claude directory if it exists", () => {
            mockExistsSync.mockReturnValue(true);

            strategy.clearCredentials();

            expect(mockRmSync).toHaveBeenCalledWith(
                expect.stringContaining('.claude'),
                { recursive: true, force: true }
            );
        });

        it("skips removal if ~/.claude does not exist", () => {
            mockExistsSync.mockReturnValue(false);

            strategy.clearCredentials();

            expect(mockRmSync).not.toHaveBeenCalled();
        });
    });
});
