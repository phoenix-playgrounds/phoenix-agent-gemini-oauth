import { jest } from "@jest/globals";

const mockSpawn = jest.fn();
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockUnlinkSync = jest.fn();
const mockMkdirSync = jest.fn();

jest.unstable_mockModule("child_process", () => ({
    spawn: mockSpawn
}));

jest.unstable_mockModule("fs", () => ({
    default: {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
        unlinkSync: mockUnlinkSync,
        mkdirSync: mockMkdirSync
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    unlinkSync: mockUnlinkSync,
    mkdirSync: mockMkdirSync
}));

const { OpenaiCodexStrategy } = await import("../src/strategies/openai_codex.mjs");

const mockChannel = {
    sendAction: jest.fn(),
    sendAuthSuccess: jest.fn(),
    sendAuthUrlGenerated: jest.fn(),
    sendAuthStatus: jest.fn()
};

describe("OpenaiCodexStrategy", () => {
    let strategy;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
        strategy = new OpenaiCodexStrategy();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("spawns codex login --device-auth and handles auth URL output", () => {
        const onStdoutData = jest.fn();
        const onStderrData = jest.fn();
        const callbacks = {};
        const mockProcess = {
            stdout: { on: onStdoutData },
            stderr: { on: onStderrData },
            on: (event, cb) => {
                callbacks[event] = cb;
            }
        };

        mockSpawn.mockReturnValue(mockProcess);

        strategy.executeAuth(mockChannel);

        expect(mockSpawn).toHaveBeenCalledWith("codex", ["login", "--device-auth"], expect.objectContaining({
            shell: false
        }));

        const stdoutCallback = onStdoutData.mock.calls[0][1];
        stdoutCallback(Buffer.from("Open this URL to sign in: https://auth.openai.com/device?user_code=ABCD-1234"));

        expect(mockChannel.sendAuthUrlGenerated).toHaveBeenCalledWith(
            "https://auth.openai.com/device?user_code=ABCD-1234"
        );
    });

    it("sends auth_success when codex login exits with code 0", () => {
        const callbacks = {};
        const mockProcess = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: (event, cb) => {
                callbacks[event] = cb;
            }
        };

        mockSpawn.mockReturnValue(mockProcess);

        strategy.executeAuth(mockChannel);
        callbacks.close(0);

        expect(mockChannel.sendAuthSuccess).toHaveBeenCalled();
    });

    it("executes prompt via codex exec --full-auto", async () => {
        const onStdoutData = jest.fn();
        const onStderrData = jest.fn();
        const callbacks = {};
        const mockProcess = {
            stdout: { on: onStdoutData },
            stderr: { on: onStderrData },
            on: (event, cb) => {
                callbacks[event] = cb;
            }
        };

        mockExistsSync.mockReturnValue(true);
        mockSpawn.mockReturnValue(mockProcess);

        const promise = strategy.executePrompt("test prompt");

        expect(mockSpawn).toHaveBeenCalledWith("codex", ["exec", "--yolo", "test prompt"], expect.objectContaining({
            shell: false
        }));

        const stdoutCallback = onStdoutData.mock.calls[0][1];
        stdoutCallback(Buffer.from("Codex result here"));

        callbacks.close(0);

        const result = await promise;
        expect(result).toBe("Codex result here");
    });

    describe("checkAuthStatus", () => {
        it("resolves true if auth.json exists with access_token", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(JSON.stringify({ access_token: "abc123" }));

            await expect(strategy.checkAuthStatus()).resolves.toBe(true);
        });

        it("resolves true if auth.json exists with api_key", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(JSON.stringify({ api_key: "sk-abc" }));

            await expect(strategy.checkAuthStatus()).resolves.toBe(true);
        });

        it("resolves false if auth.json does not exist", async () => {
            mockExistsSync.mockReturnValue(false);

            await expect(strategy.checkAuthStatus()).resolves.toBe(false);
        });

        it("resolves false if auth.json is malformed", async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("not json");

            await expect(strategy.checkAuthStatus()).resolves.toBe(false);
        });
    });

    describe("clearCredentials", () => {
        it("deletes auth.json if it exists", () => {
            mockExistsSync.mockReturnValue(true);

            strategy.clearCredentials();

            expect(mockUnlinkSync).toHaveBeenCalled();
        });

        it("does nothing if auth.json does not exist", () => {
            mockExistsSync.mockReturnValue(false);

            strategy.clearCredentials();

            expect(mockUnlinkSync).not.toHaveBeenCalled();
        });
    });
});
