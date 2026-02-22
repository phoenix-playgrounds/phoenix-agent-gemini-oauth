import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 3100;

export const createChatServer = (orchestrator) => {
    const port = parseInt(process.env.CHAT_PORT || DEFAULT_PORT, 10);
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ server, path: "/ws" });

    app.use(express.static(path.join(__dirname, "public")));

    let activeClient = null;

    const sendToClient = (type, data = {}) => {
        if (activeClient && activeClient.readyState === 1) {
            activeClient.send(JSON.stringify({ type, ...data }));
        }
    };

    orchestrator.on("outbound", (type, data) => {
        sendToClient(type, data);
    });

    wss.on("connection", (ws) => {
        if (activeClient && activeClient.readyState === 1) {
            ws.close(4000, "Another session is already active");
            return;
        }

        activeClient = ws;
        console.log("[Chat Server] Client connected");

        orchestrator.handleClientConnected();

        ws.on("message", (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                console.error("[Chat Server] Invalid JSON:", raw.toString());
                return;
            }

            orchestrator.handleClientMessage(msg);
        });

        ws.on("close", () => {
            console.log("[Chat Server] Client disconnected");
            if (activeClient === ws) {
                activeClient = null;
            }
        });

        ws.on("error", (err) => {
            console.error("[Chat Server] WS error:", err.message);
        });
    });

    server.listen(port, "0.0.0.0", () => {
        console.log(`[Chat Server] Listening on http://0.0.0.0:${port}`);
    });

    return server;
};
