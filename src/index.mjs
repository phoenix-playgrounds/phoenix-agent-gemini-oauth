import { startAgent } from "./agent.mjs";

console.log("Starting Phoenix Agent...");
startAgent();

const gracefulShutdown = () => {
    console.log("\nReceived shutdown signal. Stopping agent gracefully...");
    process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
