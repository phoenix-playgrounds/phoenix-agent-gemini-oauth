import { MockStrategy } from "./mock.mjs";
import { GeminiStrategy } from "./gemini.mjs";
import { ClaudeCodeStrategy } from "./claude_code.mjs";
import { OpenaiCodexStrategy } from "./openai_codex.mjs";
import { OpencodeStrategy } from "./opencode.mjs";

const PROVIDERS = {
    gemini: GeminiStrategy,
    "claude-code": ClaudeCodeStrategy,
    "openai-codex": OpenaiCodexStrategy,
    opencodex: OpencodeStrategy,
    mock: MockStrategy
};

const DEFAULT_PROVIDER = 'gemini';

export const resolveStrategy = () => {
    const providerName = process.env.AGENT_PROVIDER || DEFAULT_PROVIDER;
    const StrategyClass = PROVIDERS[providerName];

    if (!StrategyClass) {
        throw new Error(`Unknown AGENT_PROVIDER: '${providerName}'. Available: ${Object.keys(PROVIDERS).join(', ')}`);
    }

    console.log(`[STRATEGY] Using provider: ${providerName}`);
    return new StrategyClass();
};
