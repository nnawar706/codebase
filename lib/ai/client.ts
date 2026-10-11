import { GoogleGenAI, type GenerateContentConfig } from "@google/genai";
import { Client } from "langsmith";
import { traceable } from "langsmith/traceable";
import { wrapGemini } from "langsmith/wrappers/gemini";
import { env } from "../env.ts";

// The only place a model client is constructed. Everything that calls a model
// goes through `generate` below, which is the wrapped client, so a call made
// anywhere else would be the one call missing from the traces.

/**
 * Pinned exactly. Google lists this id as version 3.6-flash-07-2026 and offers
 * no dated alias for it; the moving aliases (gemini-flash-latest) are what
 * this avoids. The name is part of every cache key.
 */
export const MODEL = "gemini-3.6-flash";

/**
 * Tracing is on when both of these are set, and only then. The same check
 * decides what the wrapper does and what the screen says, so the two can't
 * disagree. Read straight from process.env: these are optional, and lib/env
 * is for what the app can't start without.
 */
export function tracingState(): { on: true; project: string } | { on: false; reason: string } {
  if (process.env.LANGSMITH_TRACING?.trim() !== "true") return { on: false, reason: "LANGSMITH_TRACING is not \"true\"" };
  if (!process.env.LANGSMITH_API_KEY?.trim()) return { on: false, reason: "LANGSMITH_API_KEY is not set" };
  return { on: true, project: process.env.LANGSMITH_PROJECT?.trim() || "default" };
}

const tracingEnabled = tracingState().on;
// One LangSmith client for the wrapper and every traced function, so a single
// flush sends everything a request recorded.
const tracer = new Client();
// Gemini answers 503 under load often enough that one is expected in a
// session, and a retry a second later usually lands. A 429 isn't retried: on
// the free tier it means the quota is spent, and waiting won't bring it back.
const retryOptions = { attempts: 3, initialDelay: 1, maxDelay: 4, httpStatusCodes: [500, 502, 503, 504] };
const gemini = wrapGemini(new GoogleGenAI({ apiKey: env("GOOGLE_API_KEY"), httpOptions: { retryOptions } }), {
  client: tracer,
  tracingEnabled,
});

/**
 * A traced function. Runs inside it, including cache reads, appear as children
 * of its run. `record` says what the trace keeps of the argument and the
 * result, so a run shows what was asked and answered without carrying
 * database clients, whole files or values that don't serialize.
 */
export function traced<A extends object, R>(
  name: string,
  fn: (arg: A) => Promise<R>,
  record: { inputs: (arg: A) => Record<string, unknown>; outputs: (result: R) => Record<string, unknown> },
): (arg: A) => Promise<R> {
  // Built per call so the summaries close over the values they describe
  // rather than the shapes langsmith hands its hooks.
  return async (arg) => {
    let result: { value: R } | null = null;
    // Takes no arguments: langsmith's wrapper type can't be called while the
    // argument type is still generic, and the trace's inputs come from
    // `record` either way.
    const run = traceable(
      async () => {
        result = { value: await fn(arg) };
        return result.value;
      },
      {
        name,
        run_type: "chain",
        client: tracer,
        tracingEnabled,
        processInputs: () => record.inputs(arg),
        processOutputs: () => (result ? record.outputs(result.value) : {}),
      },
    );
    return run();
  };
}

/**
 * One model call. Throws when the model answers with no text, rather than
 * passing an empty string on as if it were an answer.
 */
export async function generate(prompt: string, config: GenerateContentConfig): Promise<string> {
  const response = await gemini.models.generateContent({ model: MODEL, contents: prompt, config });
  const text = response.text?.trim();
  if (!text) {
    const reason = response.candidates?.[0]?.finishReason ?? "no candidates";
    throw new Error(`${MODEL} returned no text (${reason})`);
  }
  return text;
}

/**
 * Traces are sent in the background. A server action or a script that ends
 * before they're sent loses them, so whatever started the work waits on this.
 */
export function flushTraces(): Promise<void> {
  return tracer.awaitPendingTraceBatches();
}

/** What a failed call says on screen: the provider's own reason, with the quota case named. */
export function describeFailure(failure: unknown): string {
  const message = failure instanceof Error ? failure.message : String(failure);
  const status = typeof failure === "object" && failure !== null && "status" in failure ? failure.status : null;
  if (status === 429) return `${MODEL} refused the request: the API key's quota or rate limit is used up. ${message}`;
  if (status === 503) return `${MODEL} is overloaded and stayed that way through three attempts. Try again shortly.`;
  return message;
}
