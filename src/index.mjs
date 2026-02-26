import { startAgent } from "./agent.mjs";

console.log("Starting Phoenix Agent...");
startAgent();

let shutdownCount = 0;
const gracefulShutdown = () => {
    shutdownCount++;
    console.log(`\nReceived shutdown signal (${shutdownCount}). Stopping agent...`);
    if (shutdownCount >= 2) {
        console.log("Forcing exit immediately...");
        process.exit(1);
    }
    // Attempt standard exit
    setTimeout(() => { process.exit(0); }, 200);
};

// Listen generically for all termination signals
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
    process.on(signal, gracefulShutdown);
});
