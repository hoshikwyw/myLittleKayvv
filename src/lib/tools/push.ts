import { z } from "zod";
import { pushPlace, pushText } from "@/lib/notify/push";
import { defineTool } from "./types";

/**
 * "Send that to my phone."
 *
 * The assistant already knows things worth carrying out of the house — where a
 * pharmacy is, when a plan starts — and until now the only way to take them
 * along was to read the screen and retype it.
 *
 * Only registered when Telegram is configured, unlike the keyless tools: there
 * is no free fallback for reaching a phone, and a tool that always fails
 * teaches the model to stop reaching for it.
 */

export const sendToPhone = defineTool({
  name: "send_to_phone",
  description:
    "Send a message to the user's phone on Telegram. Use it when they ask " +
    "for something to be sent, shared, or saved for later. Include latitude " +
    "and longitude to send a real map pin they can tap for directions — look " +
    "the place up with find_places first rather than guessing coordinates. " +
    "Do not use it to repeat an answer they can already see on screen.",
  schema: z.object({
    message: z
      .string()
      .min(1)
      .max(2000)
      .describe("What to send. Plain sentences; this is read on a phone."),
    place: z
      .object({
        name: z.string().min(1).max(120),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        address: z.string().max(300).optional(),
      })
      .optional()
      .describe("A location to send as a tappable pin, alongside the message"),
  }),
  // Nothing is stored, but it leaves the machine and cannot be taken back,
  // which is the same thing this flag protects against elsewhere.
  mutates: true,
  handler: async ({ message, place }) => {
    const text = await pushText(message);

    if (!text.ok) {
      return {
        sent: false,
        // Named plainly so the model tells the truth about it rather than
        // saying "sent!" and leaving the user waiting for a buzz.
        error: `Telegram refused the message: ${text.error}`,
      };
    }

    if (!place) return { sent: true, delivered: ["message"] };

    const pin = await pushPlace(place);

    return {
      sent: true,
      delivered: pin.ok ? ["message", "map pin"] : ["message"],
      // The message went and the pin did not. Both halves are worth saying.
      ...(pin.ok ? {} : { partialFailure: `The pin failed: ${pin.error}` }),
    };
  },
});
