import { describe, expect, it } from "bun:test";
import { describeCodexOAuthFailure } from "./codex-oauth-failure";

describe("Codex OAuth failure messages", () => {
  it("distinguishes secure persistence from ChatGPT authorization", () => {
    expect(describeCodexOAuthFailure(new Error("platform detail"), "persistence")).toEqual({
      code: "secure-store",
      message: "ChatGPT signed in, but PROTEUS could not save the credential in Windows Credential Manager. Restart PROTEUS and try again.",
    });
  });

  it("gives safe actionable messages for known upstream completion failures", () => {
    expect(describeCodexOAuthFailure(new Error("Token exchange failed"), "authorization").code).toBe("token-exchange");
    expect(describeCodexOAuthFailure(new Error("Missing authorization code"), "authorization").code).toBe("callback-missing");
    expect(describeCodexOAuthFailure(new Error("Failed to extract ChatGPT account id from OpenAI Codex token"), "authorization").code).toBe("account-missing");
  });

  it("never exposes an unknown upstream error in the UI", () => {
    const secret = "sensitive-value";
    const failure = describeCodexOAuthFailure(new Error(secret), "authorization");
    expect(failure.code).toBe("authorization");
    expect(failure.message).not.toContain(secret);
  });
});
