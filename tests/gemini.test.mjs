import { jest } from "@jest/globals";

const mockSpawn = jest.fn();

jest.unstable_mockModule("child_process", () => ({
    spawn: mockSpawn
}));

const { GeminiStrategy } = await import("../src/strategies/gemini.mjs");

const mockChannel = {
    sendAction: jest.fn(),
    sendAuthSuccess: jest.fn(),
    sendAuthUrlGenerated: jest.fn(),
    sendAuthStatus: jest.fn()
};

describe("GeminiStrategy", () => {
    let strategy;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
        strategy = new GeminiStrategy();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("spawns gemini and handles auth output", () => {
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

        expect(mockSpawn).toHaveBeenCalledWith("gemini", [""], expect.objectContaining({
            shell: false,
            env: expect.objectContaining({ NO_BROWSER: 'true' })
        }));

        const stdoutCallback = onStdoutData.mock.calls[0][1];
        stdoutCallback(Buffer.from("Please go to https://accounts.google.com/o/oauth2/xxx to authorize"));

        expect(mockChannel.sendAuthUrlGenerated).toHaveBeenCalledWith(
            "https://accounts.google.com/o/oauth2/xxx"
        );
    });

    it("executes prompt and returns resolved result", async () => {
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

        const promise = strategy.executePrompt("test prompt");

        expect(mockSpawn).toHaveBeenCalledWith("gemini", ["--yolo", "test prompt"], expect.objectContaining({
            shell: false,
            env: expect.objectContaining({ GEMINI_SYSTEM_MD: expect.any(String) })
        }));

        const stdoutCallback = onStdoutData.mock.calls[0][1];
        stdoutCallback(Buffer.from("Gemini result here"));

        callbacks.close(0);

        const result = await promise;
        expect(result).toBe("Gemini result here");
    });

    describe("checkAuthStatus", () => {
        let onStdoutData, onStderrData, callbacks, mockProcess;

        beforeEach(() => {
            onStdoutData = jest.fn((event, cb) => {
                if (event === 'data') callbacks.stdoutData = cb;
            });
            onStderrData = jest.fn((event, cb) => {
                if (event === 'data') callbacks.stderrData = cb;
            });
            callbacks = {};
            mockProcess = {
                stdout: { on: onStdoutData },
                stderr: { on: onStderrData },
                kill: jest.fn(),
                on: (event, cb) => {
                    callbacks[event] = cb;
                }
            };
            mockSpawn.mockReturnValue(mockProcess);
        });

        it("resolves true if auth url is not printed", async () => {
            const resultPromise = strategy.checkAuthStatus();

            if (callbacks.stdoutData) {
                callbacks.stdoutData(Buffer.from("Just running gemini normally\n"));
            }
            if (callbacks.close) callbacks.close(0);

            await expect(resultPromise).resolves.toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith("gemini", [""], expect.objectContaining({ shell: false }));
        });

        it("resolves false if auth url is printed", async () => {
            const resultPromise = strategy.checkAuthStatus();

            if (callbacks.stdoutData) {
                callbacks.stdoutData(Buffer.from("Please go to https://accounts.google.com/o/oauth2/auth to login\n"));
            }
            if (callbacks.close) callbacks.close(0);

            await expect(resultPromise).resolves.toBe(false);
        });

        it("resolves false if process fails to spawn", async () => {
            const resultPromise = strategy.checkAuthStatus();

            if (callbacks.error) callbacks.error(new Error("enoent"));

            await expect(resultPromise).resolves.toBe(false);
        });
    });
});
