import { spawn } from "child_process";

const CHAT_PORT = 3199;

let agentProcess;

const cleanup = () => {
    if (agentProcess) agentProcess.kill();
};

const run = async () => {
    console.log("Starting agent with mock provider...");

    agentProcess = spawn("node", ["src/index.mjs"], {
        env: {
            ...process.env,
            PATH: `${process.cwd()}/tests/bin:${process.env.PATH}`,
            AGENT_PROVIDER: "mock",
            AGENT_PASSWORD: "testpassword123",
            CHAT_PORT: String(CHAT_PORT)
        }
    });

    agentProcess.stdout.on("data", (data) => console.log(`[AGENT] ${data.toString().trim()}`));
    agentProcess.stderr.on("data", (data) => console.error(`[AGENT ERR] ${data.toString().trim()}`));

    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("Connecting WebSocket...");
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`ws://localhost:${CHAT_PORT}/ws`, {
        headers: {
            Cookie: "agent_auth=testpassword123"
        }
    });

    const messages = [];

    ws.on("message", (raw) => {
        const data = JSON.parse(raw.toString());
        console.log(`[WS RECV] ${JSON.stringify(data)}`);
        messages.push(data);
    });

    await new Promise((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
    });

    console.log("WebSocket connected. Waiting for auth_status...");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const authStatus = messages.find((m) => m.type === "auth_status");
    if (!authStatus || authStatus.status !== "authenticated") {
        throw new Error(`Expected auth_status=authenticated, got: ${JSON.stringify(authStatus)}`);
    }
    console.log("✅ Auth status: authenticated");

    console.log("Sending chat message...");
    ws.send(JSON.stringify({ action: "send_chat_message", text: "hello world" }));

    console.log("Waiting for response stream to complete...");
    await new Promise((resolve) => {
        const checkStreamEnd = (raw) => {
            const data = JSON.parse(raw.toString());
            if (data.type === "stream_end") {
                ws.off("message", checkStreamEnd);
                resolve();
            }
        };
        ws.on("message", checkStreamEnd);
    });

    console.log("Fetching message history from API...");
    const fetchApi = await import("http");
    const getMessages = () => new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: CHAT_PORT,
            path: '/api/messages',
            headers: {
                Cookie: "agent_auth=testpassword123"
            }
        };
        fetchApi.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });

    const apiMessages = await getMessages();
    const chatResponse = apiMessages.find((m) => m.role === "assistant");

    if (!chatResponse || !chatResponse.body) {
        throw new Error(`Expected message with role=assistant, got: ${JSON.stringify(apiMessages)}`);
    }
    console.log(`✅ Chat response: ${chatResponse.body}`);
    if (!chatResponse.id || !chatResponse.created_at) {
        throw new Error("Message missing id or created_at");
    }
    console.log(`✅ Message has UUID (${chatResponse.id}) and timestamp (${chatResponse.created_at})`);

    ws.close();
    cleanup();
    console.log("\n✅ Integration test passed!");
    process.exit(0);
};

run().catch((err) => {
    console.error("❌ Integration test failed:", err);
    cleanup();
    process.exit(1);
});

setTimeout(() => {
    console.error("❌ Integration test timed out");
    cleanup();
    process.exit(1);
}, 15000);
