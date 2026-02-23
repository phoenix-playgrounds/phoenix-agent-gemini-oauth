import { jest } from "@jest/globals";

const mockCheckAuthStatus = jest.fn();
const mockExecuteAuth = jest.fn();
const mockSubmitAuthCode = jest.fn();
const mockCancelAuth = jest.fn();
const mockClearCredentials = jest.fn();
const mockExecutePrompt = jest.fn();
const mockGetModelArgs = jest.fn().mockReturnValue([]);

jest.unstable_mockModule("../src/strategies/index.mjs", () => ({
    resolveStrategy: () => ({
        checkAuthStatus: mockCheckAuthStatus,
        executeAuth: mockExecuteAuth,
        submitAuthCode: mockSubmitAuthCode,
        cancelAuth: mockCancelAuth,
        clearCredentials: mockClearCredentials,
        executePrompt: mockExecutePrompt,
        getModelArgs: mockGetModelArgs
    })
}));

jest.unstable_mockModule("../src/message_store.mjs", () => {
    let messages = [];
    return {
        MessageStore: class {
            all() { return messages; }
            add(role, body) {
                const msg = { id: "uuid-" + messages.length, role, body, created_at: new Date().toISOString() };
                messages.push(msg);
                return msg;
            }
            clear() { messages = []; }
        }
    };
});

let mockModelValue = "";
jest.unstable_mockModule("../src/model_store.mjs", () => ({
    ModelStore: class {
        get() { return mockModelValue; }
        set(model) { mockModelValue = (model || "").trim(); return mockModelValue; }
    }
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
        mockModelValue = "";

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
        it("sends cached auth_status immediately", () => {
            orchestrator.isAuthenticated = true;
            orchestrator.handleClientConnected();
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "authenticated", isProcessing: false }]);
        });

        it("sends unauthenticated when not yet authenticated", () => {
            orchestrator.isAuthenticated = false;
            orchestrator.handleClientConnected();
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "unauthenticated", isProcessing: false }]);
        });
    });

    describe("check_auth_status", () => {
        it("checks and sends auth status", async () => {
            mockCheckAuthStatus.mockResolvedValue(true);
            await orchestrator.handleClientMessage({ action: "check_auth_status" });
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "authenticated", isProcessing: false }]);
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
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "unauthenticated", isProcessing: false }]);
        });
    });

    describe("reauthenticate", () => {
        it("clears credentials and restarts auth", async () => {
            await orchestrator.handleClientMessage({ action: "reauthenticate" });
            expect(mockCancelAuth).toHaveBeenCalled();
            expect(mockClearCredentials).toHaveBeenCalled();
            expect(outboundMessages).toEqual([{ type: "auth_status", status: "unauthenticated", isProcessing: false }]);
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

        it("persists user and assistant messages on success", async () => {
            orchestrator.isAuthenticated = true;
            mockExecutePrompt.mockResolvedValue("AI response");
            await orchestrator.handleClientMessage({ action: "send_chat_message", text: "hello" });
            expect(outboundMessages.length).toBe(2);
            expect(outboundMessages[0].type).toBe("message");
            expect(outboundMessages[0].role).toBe("user");
            expect(outboundMessages[0].body).toBe("hello");
            expect(outboundMessages[0].id).toBeDefined();
            expect(outboundMessages[1].type).toBe("message");
            expect(outboundMessages[1].role).toBe("assistant");
            expect(outboundMessages[1].body).toBe("AI response");
            expect(orchestrator.isProcessing).toBe(false);
        });

        it("sends error on prompt failure", async () => {
            orchestrator.isAuthenticated = true;
            mockExecutePrompt.mockRejectedValue(new Error("CLI failed"));
            await orchestrator.handleClientMessage({ action: "send_chat_message", text: "hello" });
            const errorMsg = outboundMessages.find(m => m.type === "error");
            expect(errorMsg.message).toBe("CLI failed");
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

    describe("get_model", () => {
        it("sends current model", async () => {
            mockModelValue = "flash-lite";
            await orchestrator.handleClientMessage({ action: "get_model" });
            expect(outboundMessages).toEqual([{ type: "model_updated", model: "flash-lite" }]);
        });
    });

    describe("set_model", () => {
        it("sets model and sends update", async () => {
            await orchestrator.handleClientMessage({ action: "set_model", model: "pro" });
            expect(mockModelValue).toBe("pro");
            expect(outboundMessages).toEqual([{ type: "model_updated", model: "pro" }]);
        });

        it("clears model with empty string", async () => {
            mockModelValue = "flash";
            await orchestrator.handleClientMessage({ action: "set_model", model: "" });
            expect(mockModelValue).toBe("");
            expect(outboundMessages).toEqual([{ type: "model_updated", model: "" }]);
        });
    });
});
