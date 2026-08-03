import { Electroview } from "electrobun/view";
import type { ProteusRPCSchema } from "../shared/contracts";

export const electroview = new Electroview({
  rpc: Electroview.defineRPC<ProteusRPCSchema>({
    maxRequestTime: 60_000,
    handlers: { messages: {} },
  }),
});

export const rpc = electroview.rpc!;
