import { startAgent } from "./agent.mjs";

console.log("Starting Phoenix Agent...");
const ws = startAgent();

const gracefulShutdown = () => {
    console.log("\nReceived shutdown signal. Stopping agent gracefully...");
    if (ws && ws.readyState === 1) { // 1 = OPEN
        ws.close();
    }
    process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
