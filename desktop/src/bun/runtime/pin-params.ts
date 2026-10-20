import { z } from "zod";

/** `threads.pin` params as they arrive over RPC: `pinned` must really be a boolean ("false" would otherwise pin). */
export const pinParamsSchema = z.object({ threadId: z.string().min(1), pinned: z.boolean() }).strict();
