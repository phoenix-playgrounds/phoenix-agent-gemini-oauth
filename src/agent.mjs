import { Orchestrator } from "./websocket.mjs";
import { createChatServer } from "./server.mjs";

export const startAgent = () => {
    const orchestrator = new Orchestrator();
    createChatServer(orchestrator);
    return orchestrator;
};
