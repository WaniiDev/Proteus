export type CodexOAuthFailureStage = "authorization" | "persistence";

export type CodexOAuthFailure = {
  code: "callback-missing" | "token-exchange" | "account-missing" | "secure-store" | "authorization";
  message: string;
};

export function describeCodexOAuthFailure(error: unknown, stage: CodexOAuthFailureStage): CodexOAuthFailure {
  if (stage === "persistence") {
    return {
      code: "secure-store",
      message: "ChatGPT signed in, but PROTEUS could not save the credential in Windows Credential Manager. Restart PROTEUS and try again.",
    };
  }

  const detail = error instanceof Error ? error.message : String(error);
  if (/token exchange failed/i.test(detail)) {
    return {
      code: "token-exchange",
      message: "ChatGPT accepted the sign-in, but the secure token exchange failed. Check VPN or proxy settings, then try again.",
    };
  }
  if (/missing authorization code|state mismatch/i.test(detail)) {
    return {
      code: "callback-missing",
      message: "ChatGPT accepted the sign-in, but the localhost callback did not reach PROTEUS. Try again or use device code.",
    };
  }
  if (/failed to extract chatgpt account id/i.test(detail)) {
    return {
      code: "account-missing",
      message: "ChatGPT signed in, but the returned credential did not identify a ChatGPT account. Try device code or sign in with another eligible account.",
    };
  }
  return {
    code: "authorization",
    message: "ChatGPT authorization did not complete. Try browser sign-in again or use device code.",
  };
}
