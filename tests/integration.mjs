import { WebSocketServer } from "ws";
import { spawn } from "child_process";

const wss = new WebSocketServer({ port: 8081 });
console.log("Mock ActionCable server listening on ws://localhost:8081");

let agentProcess;

wss.on("listening", () => {
    agentProcess = spawn("node", ["src/index.mjs"], {
        env: { ...process.env, WS_URL: "ws://localhost:8081", PATH: `${process.cwd()}/tests/bin:${process.env.PATH}`, AGENT_SECRET: "secret", PLAYGROUND_ID: 1 }
    });

    agentProcess.stdout.on("data", (data) => console.log(`[AGENT] ${data.toString().trim()}`));
    agentProcess.stderr.on("data", (data) => console.error(`[AGENT ERR] ${data.toString().trim()}`));
});

wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "welcome" }));

    ws.on("message", (message) => {
        const data = JSON.parse(message.toString());

        if (data.command === "subscribe") {
            ws.send(JSON.stringify({
                identifier: data.identifier,
                type: "confirm_subscription"
            }));
            setTimeout(() => {
                ws.send(JSON.stringify({
                    identifier: data.identifier,
                    message: { start_auth: true }
                }));
            }, 500);
        } else if (data.command === "message") {
            const payload = data.data;
            const parsedData = typeof payload === "string" ? JSON.parse(payload) : payload;

            if (parsedData.action === "url_generated") {
                console.log("Agent sent Auth URL:", parsedData.url);
            } else if (parsedData.action === "prompt_completed") {
                console.log("Agent completed prompt:", parsedData.result);
                if (agentProcess) agentProcess.kill();
                process.exit(0);
            } else if (parsedData.action === "auth_success") {
                console.log("Agent confirmed authentication step");
            } else if (parsedData.action === "STATUS_RESPONSE") {
                console.log(`Agent broadcasted STATUS_RESPONSE: ${parsedData.status}`);
            } else if (parsedData.action === "AUTH_STATUS_RESPONSE") {
                console.log(`Agent broadcasted AUTH_STATUS_RESPONSE: ${parsedData.status}`);
            } else if (parsedData.action === "prompt_failed") {
                console.log("Agent failed prompt:", parsedData.error);
                if (agentProcess) agentProcess.kill();
                process.exit(1);
            }
        }
    });

    setTimeout(() => {
        ws.send(JSON.stringify({
            identifier: JSON.stringify({ channel: "AuthChannel" }),
            message: { prompt: "echo 'hello'" } // using echo 'hello' so the test works even if gemini is not installed/authenticated
        }));
    }, 2000);
});

setTimeout(() => {
    console.error("Integration test timed out");
    if (agentProcess) agentProcess.kill();
    process.exit(1);
}, 10000);
