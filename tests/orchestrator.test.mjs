import { jest } from "@jest/globals";

const mockCheckAuthStatus = jest.fn();
const mockExecuteAuth = jest.fn();
const mockSubmitAuthCode = jest.fn();
const mockCancelAuth = jest.fn();
const mockClearCredentials = jest.fn();
const mockExecutePrompt = jest.fn();

jest.unstable_mockModule("../src/strategies/index.mjs", () => ({
    resolveStrategy: () => ({
        checkAuthStatus: mockCheckAuthStatus,
        executeAuth: mockExecuteAuth,
        submitAuthCode: mockSubmitAuthCode,
        cancelAuth: mockCancelAuth,
        clearCredentials: mockClearCredentials,
        executePrompt: mockExecutePrompt
    })
}));

const { Orchestrator } = await import("../src/websocket.mjs");

describe("Orchestrator", () => {
    let orchestrator;
    let outboundMessages;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, "log").mockImplementation(() => { });
        jest.spyOn(console, "warn").mockImplementation(() => { });
        jest.spyOn(console, "error").mockImplementation(() => { });

        outboundMessages = [];
        orchestrator = new Orchestrator();
        orchestrator.on("outbound", (type, data) => {
            outboundMessages.push({ type, ...data });
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("handleClientConnected", () => {
        it("sends auth_status authenticated when strategy returns true", async () => {
            mockCheckAuthStatus.mockResolvedValue(true);
            await orchestrator.handleClientConnected();
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "authenticated" }]);
        });

        it("sends auth_status unauthenticated when strategy returns false", async () => {
            mockCheckAuthStatus.mockResolvedValue(false);
            await orchestrator.handleClientConnected();
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "unauthenticated" }]);
        });
    });

    describe("check_auth_status", () => {
        it("checks and sends auth status", async () => {
            mockCheckAuthStatus.mockResolvedValue(true);
            await orchestrator.handleClientMessage({ action: "check_auth_status" });
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "authenticated" }]);
        });
    });

    describe("initiate_auth", () => {
        it("sends auth_success if already authenticated", async () => {
            mockCheckAuthStatus.mockResolvedValue(true);
            await orchestrator.handleClientMessage({ action: "initiate_auth" });
            expect(outboundMessages).toEqual([{ type: "auth_success" }]);
            expect(mockExecuteAuth).not.toHaveBeenCalled();
        });

        it("calls strategy.executeAuth if not authenticated", async () => {
            mockCheckAuthStatus.mockResolvedValue(false);
            await orchestrator.handleClientMessage({ action: "initiate_auth" });
            expect(mockExecuteAuth).toHaveBeenCalledWith(expect.objectContaining({
                sendAuthUrlGenerated: expect.any(Function),
                sendAuthSuccess: expect.any(Function)
            }));
        });
    });

    describe("submit_auth_code", () => {
        it("forwards code to strategy", async () => {
            await orchestrator.handleClientMessage({ action: "submit_auth_code", code: "abc123" });
            expect(mockSubmitAuthCode).toHaveBeenCalledWith("abc123");
        });
    });

    describe("cancel_auth", () => {
        it("cancels auth and sends unauthenticated status", async () => {
            await orchestrator.handleClientMessage({ action: "cancel_auth" });
            expect(mockCancelAuth).toHaveBeenCalled();
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "unauthenticated" }]);
        });
    });

    describe("reauthenticate", () => {
        it("clears credentials and restarts auth", async () => {
            await orchestrator.handleClientMessage({ action: "reauthenticate" });
            expect(mockCancelAuth).toHaveBeenCalled();
            expect(mockClearCredentials).toHaveBeenCalled();
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "unauthenticated" }]);
            expect(mockExecuteAuth).toHaveBeenCalled();
        });
    });

    describe("send_chat_message", () => {
        it("rejects when not authenticated", async () => {
            orchestrator.isAuthenticated = false;
            await orchestrator.handleClientMessage({ action: "send_chat_message", text: "hello" });
            expect(outboundMessages).toEqual([{ type: "error", message: "NEED_AUTH" }]);
        });

        it("rejects when already processing", async () => {
            orchestrator.isAuthenticated = true;
            orchestrator.isProcessing = true;
            await orchestrator.handleClientMessage({ action: "send_chat_message", text: "hello" });
            expect(outboundMessages).toEqual([{ type: "error", message: "BLOCKED" }]);
        });

        it("sends chat_message_in on success", async () => {
            orchestrator.isAuthenticated = true;
            mockExecutePrompt.mockResolvedValue("AI response");
            await orchestrator.handleClientMessage({ action: "send_chat_message", text: "hello" });
            expect(outboundMessages).toEqual([{ type: "chat_message_in", text: "AI response" }]);
            expect(orchestrator.isProcessing).toBe(false);
        });

        it("sends error on prompt failure", async () => {
            orchestrator.isAuthenticated = true;
            mockExecutePrompt.mockRejectedValue(new Error("CLI failed"));
            await orchestrator.handleClientMessage({ action: "send_chat_message", text: "hello" });
            expect(outboundMessages).toEqual([{ type: "error", message: "CLI failed" }]);
            expect(orchestrator.isProcessing).toBe(false);
        });
    });

    describe("strategy bridge", () => {
        it("sendAuthUrlGenerated emits outbound auth_url_generated", async () => {
            mockCheckAuthStatus.mockResolvedValue(false);
            mockExecuteAuth.mockImplementation((conn) => {
                conn.sendAuthUrlGenerated("https://example.com/auth");
            });
            await orchestrator.handleClientMessage({ action: "initiate_auth" });
            expect(outboundMessages).toEqual([{ type: "auth_url_generated", url: "https://example.com/auth" }]);
        });

        it("sendAuthSuccess sets isAuthenticated and emits outbound", async () => {
            mockCheckAuthStatus.mockResolvedValue(false);
            mockExecuteAuth.mockImplementation((conn) => {
                conn.sendAuthSuccess();
            });
            await orchestrator.handleClientMessage({ action: "initiate_auth" });
            expect(orchestrator.isAuthenticated).toBe(true);
            expect(outboundMessages).toEqual([{ type: "auth_success" }]);
        });
    });
});
