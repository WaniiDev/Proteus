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
const MODEL_USAGE_COLLECTION = "proteus_model_usage";
const ACTIVE_MODEL_PREFERENCE_ID = "active";

export type AppModelSelection = {
  providerId: ProviderId;
  modelId: ProviderModelId;
  reasoningEffort?: ReasoningEffort;
};

export type ModelUsage = {
  providerId: ProviderId;
  modelId: ProviderModelId;
  useCount: number;
  lastUsedAt: string;
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
  conversationSelection: unknown,
  preferred: unknown,
  fallback: AppModelSelection,
): AppModelSelection {
  return parseAppModelSelection(conversationSelection)
    ?? parseAppModelSelection(preferred)
    ?? appModelSelectionSchema.parse(fallback);
}

/** Last-used model selection stored as the default for new conversations. */
export class ModelPreferencesStorage extends FactoryStorageDomain {
  constructor() {
    super("proteus-model-preferences");
  }

  async init(): Promise<void> {
    await this.ensureCollections([
      {
        name: MODEL_PREFERENCES_COLLECTION,
        columns: {
          id: { type: "text", primaryKey: true },
          provider_id: { type: "text" },
          model_id: { type: "text" },
          reasoning_effort: { type: "text", nullable: true },
          updated_at: { type: "timestamp" },
        },
      },
      {
        name: MODEL_USAGE_COLLECTION,
        columns: {
          model_id: { type: "text", primaryKey: true },
          provider_id: { type: "text" },
          use_count: { type: "integer" },
          last_used_at: { type: "timestamp" },
        },
      },
    ]);
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

  async listUsage(): Promise<ModelUsage[]> {
    await this.ensureReady();
    const rows = await this.ops.findMany<Record<string, unknown>>(MODEL_USAGE_COLLECTION, {});
    return rows.flatMap((row) => {
      const selection = parseAppModelSelection({ providerId: row.provider_id, modelId: row.model_id });
      const useCount = Number(row.use_count);
      const lastUsedAt = new Date(row.last_used_at as string | number | Date);
      if (!selection || !Number.isInteger(useCount) || useCount < 1 || Number.isNaN(lastUsedAt.valueOf())) return [];
      return [{ ...selection, useCount, lastUsedAt: lastUsedAt.toISOString() }];
    }).sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
  }

  async recordUsage(selection: AppModelSelection, usedAt = new Date()): Promise<ModelUsage> {
    await this.ensureReady();
    const validated = appModelSelectionSchema.parse(selection);
    const existing = await this.ops.findOne<Record<string, unknown>>(MODEL_USAGE_COLLECTION, { model_id: validated.modelId });
    const previousCount = Number(existing?.use_count);
    const useCount = Number.isInteger(previousCount) && previousCount > 0 ? previousCount + 1 : 1;
    await this.ops.upsertOne(MODEL_USAGE_COLLECTION, ["model_id"], {
      model_id: validated.modelId,
      provider_id: validated.providerId,
      use_count: useCount,
      last_used_at: usedAt,
    });
    return { providerId: validated.providerId, modelId: validated.modelId, useCount, lastUsedAt: usedAt.toISOString() };
  }

  async dangerouslyClearAll(): Promise<void> {
    await this.ensureReady();
    await this.ops.deleteMany(MODEL_PREFERENCES_COLLECTION, {});
    await this.ops.deleteMany(MODEL_USAGE_COLLECTION, {});
  }
}
