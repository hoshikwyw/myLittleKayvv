/**
 * Typed, validated access to environment variables.
 *
 * Rules of the road:
 *  - Server-only. Never import this from a "use client" component.
 *  - Nothing here is read at module load, so a missing key for a feature you
 *    are not using yet cannot crash the whole app. Each getter fails loudly
 *    only at the moment that feature is actually used.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to .env.local (see .env.example).`,
    );
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // --- LLM ---
  get geminiApiKey() {
    return required("GEMINI_API_KEY");
  },
  get geminiModel() {
    return optional("GEMINI_MODEL", "gemini-3.6-flash");
  },
  /**
   * Changing this later means re-embedding every stored memory — vectors from
   * two different models are not comparable.
   */
  get geminiEmbeddingModel() {
    return optional("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2");
  },

  // --- Database (Part 1) ---
  get databaseUrl() {
    return required("DATABASE_URL");
  },

  // --- Notifications (Part 8) ---
  get telegramBotToken() {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get telegramChatId() {
    return required("TELEGRAM_CHAT_ID");
  },
  get resendApiKey() {
    return required("RESEND_API_KEY");
  },
  get reminderEmailTo() {
    return optional("REMINDER_EMAIL_TO");
  },

  // --- Google tools (Part 7) ---
  get googleMapsApiKey() {
    return required("GOOGLE_MAPS_API_KEY");
  },
  get googleSearchApiKey() {
    return required("GOOGLE_SEARCH_API_KEY");
  },
  get googleSearchEngineId() {
    return required("GOOGLE_SEARCH_ENGINE_ID");
  },
  /** "lat,lng" — what "near me" resolves to when nothing else is given. */
  get homeLocation() {
    return optional("HOME_LOCATION");
  },
  get googleOauthClientId() {
    return required("GOOGLE_OAUTH_CLIENT_ID");
  },
  get googleOauthClientSecret() {
    return required("GOOGLE_OAUTH_CLIENT_SECRET");
  },
  get googleOauthRefreshToken() {
    return required("GOOGLE_OAUTH_REFRESH_TOKEN");
  },

  // --- App ---
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get assistantName() {
    return optional("ASSISTANT_NAME", "Kayv");
  },
  get ownerName() {
    return optional("OWNER_NAME", "friend");
  },
  get timezone() {
    return optional("TIMEZONE", "Asia/Yangon");
  },
} as const;

/** True when a feature's env vars are present, without throwing. */
export const configured = {
  llm: () => Boolean(process.env.GEMINI_API_KEY),
  database: () => Boolean(process.env.DATABASE_URL),
  telegram: () =>
    Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  email: () => Boolean(process.env.RESEND_API_KEY),
  maps: () => Boolean(process.env.GOOGLE_MAPS_API_KEY),
  search: () =>
    Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID),
  calendar: () =>
    Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
        process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
        process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    ),
} as const;
