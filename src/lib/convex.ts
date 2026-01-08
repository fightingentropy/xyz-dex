import { ConvexClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { createEffect, createSignal, onCleanup } from "solid-js";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is not set.");
}

export const convex = new ConvexClient(convexUrl);

export const createConvexQuery = <TArgs extends Record<string, any>, TResult>(
  query: FunctionReference<"query", TArgs, TResult>,
  args: () => TArgs | null,
  initial?: TResult,
) => {
  const [data, setData] = createSignal<TResult | undefined>(initial);

  createEffect(() => {
    const resolvedArgs = args();
    if (!resolvedArgs) {
      setData(initial);
      return;
    }
    const subscription = convex.onUpdate(
      query,
      resolvedArgs,
      (value: TResult) => {
        setData(value);
      },
      (error) => {
        console.error("Convex query error:", error);
        setData(initial);
      },
    );
    const current = subscription.getCurrentValue();
    if (current !== undefined) {
      setData(current);
    } else {
      setData(initial);
    }
    onCleanup(() => {
      subscription();
    });
  });

  return data;
};
