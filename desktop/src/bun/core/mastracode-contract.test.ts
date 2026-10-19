import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  loginOpenAICodex,
  refreshOpenAICodexToken,
} from "@mastra/code-sdk/auth/providers/openai-codex";
import type { CredentialStore } from "@mastra/code-sdk/auth/types";
import {
  MastraCodeGateway,
  createMastraCodeModelCatalogProvider,
} from "@mastra/code-sdk/agents/model";
import { openaiCodexProvider } from "@mastra/code-sdk/providers/openai-codex";

const emptyCredentialStore: CredentialStore = {
  allowEnvironmentFallback: false,
  reload() {},
  get() {
    return undefined;
  },
  getStoredApiKey() {
    return undefined;
  },
  async getApiKey() {
    return undefined;
  },
};

describe("installed MastraCode contracts", () => {
  it("loads the pinned OAuth and provider entry points under Bun", () => {
    expect(typeof loginOpenAICodex).toBe("function");
    expect(typeof refreshOpenAICodexToken).toBe("function");
    expect(typeof openaiCodexProvider).toBe("function");
  });

  it("supports the Node crypto and HTTP APIs required by browser OAuth", () => {
    expect(createHash("sha256").update("proteus").digest("hex")).toHaveLength(64);
    const server = createServer();
    expect(typeof server.listen).toBe("function");
    server.close();
  });

  it("constructs the upstream gateway with an injected credential store", () => {
    const gateway = new MastraCodeGateway({
      mastraGatewayBaseUrl: "https://mastra.ai",
      routeThroughMastraGateway: false,
      thinkingLevel: "medium",
      credentialStore: emptyCredentialStore,
    });
    const catalog = createMastraCodeModelCatalogProvider(gateway);

    expect(gateway.id).toBe("mastracode");
    expect(gateway.handlesModel("openai/gpt-5.3-codex")).toBe(false);
    expect(typeof catalog).toBe("function");
  });
});
