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

        expect(mockSpawn).toHaveBeenCalledWith("gemini", ["-p", ""], expect.objectContaining({
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

        expect(mockSpawn).toHaveBeenCalledWith("gemini", ["--yolo", "-d", "-p", "test prompt"], expect.objectContaining({
            shell: false
        }));

        const stdoutCallback = onStdoutData.mock.calls[0][1];
        stdoutCallback(Buffer.from("Gemini result here"));

        callbacks.close(0);

        const result = await promise;
        expect(result).toBe("Gemini result here");
    });

    it("passes model args when model is provided", async () => {
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

        const promise = strategy.executePrompt("test prompt", "flash-lite");

        expect(mockSpawn).toHaveBeenCalledWith("gemini", ["-m", "flash-lite", "--yolo", "-d", "-p", "test prompt"], expect.objectContaining({
            shell: false
        }));

        const stdoutCallback = onStdoutData.mock.calls[0][1];
        stdoutCallback(Buffer.from("result"));
        callbacks.close(0);

        await promise;
    });

    it("rejects with friendly error on ModelNotFoundError", async () => {
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

        const promise = strategy.executePrompt("test prompt", "bad-model");

        const stderrCallback = onStderrData.mock.calls[0][1];
        stderrCallback(Buffer.from("ModelNotFoundError: Requested entity was not found."));
        callbacks.close(1);

        await expect(promise).rejects.toThrow("Invalid model specified");
    });

    describe("getModelArgs", () => {
        it("returns empty array when no model", () => {
            expect(strategy.getModelArgs("")).toEqual([]);
            expect(strategy.getModelArgs(null)).toEqual([]);
            expect(strategy.getModelArgs(undefined)).toEqual([]);
        });

        it("returns -m flag with model name", () => {
            expect(strategy.getModelArgs("flash-lite")).toEqual(["-m", "flash-lite"]);
        });
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
            expect(mockSpawn).toHaveBeenCalledWith("gemini", ["-p", ""], expect.objectContaining({ shell: false }));
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
