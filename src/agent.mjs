import { createActionCableConsumer } from "./websocket.mjs";

export const startAgent = () => {
    return createActionCableConsumer();
};
