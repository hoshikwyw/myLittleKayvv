import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponseUsageMetadata,
  type Part,
} from "@google/genai";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { env } from "@/lib/env";
import {
  LLMError,
  type ConversationTurn,
  type EmbedOptions,
  type GenerateOptions,
  type LLMProvider,
  type StreamEvent,
} from "./types";

/** Gemini calls the assistant side "model"; the rest of the app says "assistant". */
function toGeminiContents(turns: ConversationTurn[]): Content[] {
  const contents: Content[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      contents.push({ role: "user", parts: [{ text: turn.content }] });
      continue;
    }

    if (turn.role === "assistant") {
      const parts: Part[] = [];
      if (turn.content) parts.push({ text: turn.content });
      for (const call of turn.toolCalls ?? []) {
        parts.push({
          functionCall: { id: call.id, name: call.name, args: call.args },
          // Gemini 3 refuses a follow-up request whose function call has lost
          // its thought signature, so it goes back exactly as it arrived.
          ...(isGeminiState(call.providerState)
            ? { thoughtSignature: call.providerState.thoughtSignature }
            : {}),
        });
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }

    // Tool results are sent back as a user turn — that is Gemini's convention.
    contents.push({
      role: "user",
      parts: turn.results.map((r) => ({
        functionResponse: {
          id: r.id,
          name: r.name,
          response: asResponseObject(r.result),
        },
      })),
    });
  }

  return contents;
}

interface GeminiCallState {
  thoughtSignature: string;
}

function isGeminiState(value: unknown): value is GeminiCallState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GeminiCallState).thoughtSignature === "string"
  );
}

/** functionResponse.response must be an object, so scalars get wrapped. */
function asResponseObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value };
}

/**
 * Rate limits and quota exhaustion are expected on the free tier, and the UI
 * should tell you to wait rather than claim something is broken.
 */
function classify(error: unknown): LLMError {
  const message = error instanceof Error ? error.message : String(error);
  const retryable =
    /\b(429|503|500|rate limit|quota|overloaded|unavailable|deadline)\b/i.test(
      message,
    );
  return new LLMError(message, retryable, error);
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly model: string;

  private readonly client: GoogleGenAI;

  constructor(apiKey: string = env.geminiApiKey, model: string = env.geminiModel) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamEvent> {
    const {
      turns,
      system,
      tools,
      temperature = 0.8,
      maxOutputTokens,
      signal,
    } = options;

    let usage: GenerateContentResponseUsageMetadata | undefined;

    try {
      const response = await this.client.models.generateContentStream({
        model: this.model,
        contents: toGeminiContents(turns),
        config: {
          systemInstruction: system,
          temperature,
          maxOutputTokens,
          abortSignal: signal,
          ...(tools?.length
            ? {
                tools: [
                  {
                    functionDeclarations: tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parametersJsonSchema: t.parameters,
                    })),
                  },
                ],
              }
            : {}),
        },
      });

      for await (const chunk of response) {
        if (signal?.aborted) return;

        const text = chunk.text;
        if (text) yield { type: "text", delta: text };

        // Read parts rather than the functionCalls accessor: the accessor
        // drops thoughtSignature, which the next request cannot do without.
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          const call = part.functionCall;
          if (!call?.name) continue;

          yield {
            type: "tool_call",
            call: {
              id: call.id,
              name: call.name,
              args: call.args ?? {},
              ...(part.thoughtSignature
                ? { providerState: { thoughtSignature: part.thoughtSignature } }
                : {}),
            },
          };
        }

        // Gemini repeats usageMetadata on several chunks with cumulative
        // counts. Keep the last one and report it once, after the stream ends.
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
      }

      if (usage) {
        yield {
          type: "usage",
          usage: {
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount,
          },
        };
      }
    } catch (error) {
      // An aborted request is the user interrupting, not a failure.
      if (signal?.aborted) return;

      const llmError = classify(error);
      yield {
        type: "error",
        message: llmError.message,
        retryable: llmError.retryable,
      };
    }
  }

  async embed(texts: string[], options: EmbedOptions): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      const response = await this.client.models.embedContent({
        model: env.geminiEmbeddingModel,
        contents: texts,
        config: {
          // Storing and searching are asymmetric tasks; telling the model which
          // one it is measurably improves recall.
          taskType:
            options.purpose === "query"
              ? "RETRIEVAL_QUERY"
              : "RETRIEVAL_DOCUMENT",
          outputDimensionality: options.dimensions ?? EMBEDDING_DIMENSIONS,
        },
      });

      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== texts.length) {
        throw new Error(
          `Expected ${texts.length} embeddings, received ${embeddings.length}`,
        );
      }

      return embeddings.map((e, i) => {
        if (!e.values) throw new Error(`Embedding ${i} came back empty`);
        return e.values;
      });
    } catch (error) {
      throw classify(error);
    }
  }
}
