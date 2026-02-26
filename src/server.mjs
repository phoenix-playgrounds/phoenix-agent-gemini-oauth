import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 3100;

export const createChatServer = (orchestrator) => {
    const port = parseInt(process.env.CHAT_PORT || DEFAULT_PORT, 10);
    const app = express();
    app.set('trust proxy', 1);
    const server = createServer(app);
    const wss = new WebSocketServer({ server, path: "/ws" });

    app.use(express.json());
    app.use(cookieParser());

    // Middleware to check authentication
    const requireAuth = (req, res, next) => {
        const requiredPassword = process.env.AGENT_PASSWORD;
        // If no password is required, allow access
        if (!requiredPassword) {
            return next();
        }

        // Check password from cookie
        if (req.cookies && req.cookies.agent_auth === requiredPassword) {
            return next();
        }

        // If not authenticated and requesting the page, redirect to login
        if (req.path === '/' || req.path === '/index.html') {
            return res.sendFile(path.join(__dirname, "public", "login.html"));
        }

        // Allow public assets
        if (req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.svg')) {
            return next();
        }

        // For other routes (API), return 401
        res.status(401).json({ error: "Unauthorized" });
    };

    app.post("/api/login", (req, res) => {
        const requiredPassword = process.env.AGENT_PASSWORD;
        const providedPassword = req.body && req.body.password;

        if (!requiredPassword) {
            return res.json({ success: true, message: "No authentication required" });
        }

        if (providedPassword === requiredPassword) {
            const isSecure = req.secure || req.get('x-forwarded-proto') === 'https';

            // Set cookie valid for 30 days
            res.cookie("agent_auth", providedPassword, {
                httpOnly: true,
                secure: isSecure,
                sameSite: isSecure ? "none" : "lax",
                maxAge: 30 * 24 * 60 * 60 * 1000
            });
            return res.json({ success: true });
        }

        res.status(401).json({ success: false, error: "Invalid password" });
    });

    // Apply auth middleware before serving static files (except login context handled inside)
    app.use(requireAuth);
    app.use(express.static(path.join(__dirname, "public")));

    app.get("/api/messages", (_req, res) => {
        res.json(orchestrator.messages.all());
    });

    app.get("/api/model-options", (_req, res) => {
        const raw = process.env.MODEL_OPTIONS || "";
        const options = raw.split(",").map(s => s.trim()).filter(Boolean);
        res.json(options);
    });

    let activeClient = null;

    const sendToClient = (type, data = {}) => {
        if (activeClient && activeClient.readyState === 1) {
            activeClient.send(JSON.stringify({ type, ...data }));
        }
    };

    orchestrator.on("outbound", (type, data) => {
        sendToClient(type, data);
    });

    wss.on("connection", (ws, req) => {
        const requiredPassword = process.env.AGENT_PASSWORD;

        if (requiredPassword) {
            const cookieHeader = req.headers.cookie || "";
            const match = cookieHeader.match(/agent_auth=([^;]+)/);
            const cookieValue = match ? decodeURIComponent(match[1]) : null;

            if (cookieValue !== requiredPassword) {
                ws.close(4001, "Unauthorized");
                return;
            }
        }

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
