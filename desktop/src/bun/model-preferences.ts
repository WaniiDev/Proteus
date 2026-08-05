import { FactoryStorageDomain } from "@mastra/core/storage";
import { z } from "zod";
import {
  providerIdSchema,
  providerModelIdSchema,
  reasoningEffortSchema,
  type ProviderId,
  type ProviderModelId,
  type ReasoningEffort,
} from "../shared/contracts";

const MODEL_PREFERENCES_COLLECTION = "proteus_model_preferences";
const ACTIVE_MODEL_PREFERENCE_ID = "active";

export type AppModelSelection = {
  providerId: ProviderId;
  modelId: ProviderModelId;
  reasoningEffort?: ReasoningEffort;
};

const appModelSelectionSchema = z.object({
  providerId: providerIdSchema,
  modelId: providerModelIdSchema,
  reasoningEffort: reasoningEffortSchema.optional(),
}).refine(
  (selection) => selection.modelId.startsWith(`${selection.providerId}/`),
  { message: "The selected model must belong to the selected provider" },
);

export function parseAppModelSelection(value: unknown): AppModelSelection | null {
  const parsed = appModelSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function resolveRememberedModelSelection(
  preferred: unknown,
  legacyThreadSelection: unknown,
  fallback: AppModelSelection,
): AppModelSelection {
  return parseAppModelSelection(preferred)
    ?? parseAppModelSelection(legacyThreadSelection)
    ?? appModelSelectionSchema.parse(fallback);
}

/** App-wide model preference stored through Mastra's native FactoryStorage API. */
export class ModelPreferencesStorage extends FactoryStorageDomain {
  constructor() {
    super("proteus-model-preferences");
  }

  async init(): Promise<void> {
    await this.ensureCollections([{
      name: MODEL_PREFERENCES_COLLECTION,
      columns: {
        id: { type: "text", primaryKey: true },
        provider_id: { type: "text" },
        model_id: { type: "text" },
        reasoning_effort: { type: "text", nullable: true },
        updated_at: { type: "timestamp" },
      },
    }]);
  }

  async load(): Promise<AppModelSelection | null> {
    await this.ensureReady();
    const row = await this.ops.findOne<Record<string, unknown>>(
      MODEL_PREFERENCES_COLLECTION,
      { id: ACTIVE_MODEL_PREFERENCE_ID },
    );
    if (!row) return null;
    return parseAppModelSelection({
      providerId: row.provider_id,
      modelId: row.model_id,
      ...(row.reasoning_effort ? { reasoningEffort: row.reasoning_effort } : {}),
    });
  }

  async save(selection: AppModelSelection): Promise<void> {
    await this.ensureReady();
    const validated = appModelSelectionSchema.parse(selection);
    await this.ops.upsertOne(MODEL_PREFERENCES_COLLECTION, ["id"], {
      id: ACTIVE_MODEL_PREFERENCE_ID,
      provider_id: validated.providerId,
      model_id: validated.modelId,
      reasoning_effort: validated.reasoningEffort ?? null,
      updated_at: new Date(),
    });
  }

  async dangerouslyClearAll(): Promise<void> {
    await this.ensureReady();
    await this.ops.deleteMany(MODEL_PREFERENCES_COLLECTION, {});
  }
}
