import { createActionCableConsumer } from "./websocket.mjs";

export const startAgent = () => {
    createActionCableConsumer();
};
