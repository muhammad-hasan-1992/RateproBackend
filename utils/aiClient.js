// utils/aiClient.js
//
// Gemini AI client.
// Reads GEMINI_API_KEY via configService (DB → ENV → throw).
// Uses lazy async initialization — API key is NOT read at module load.

const { GoogleGenerativeAI } = require("@google/generative-ai");
const configService = require("../services/configService");

let _genAI = null;

/**
 * Lazily initialize the Gemini AI client.
 * Reads API key from configService on first call.
 */
const getGenAI = async () => {
  if (_genAI) return _genAI;

  const apiKey = await configService.getConfig("GEMINI_API_KEY", {
    sensitive: true, // DB → ENV → THROW
  });

  _genAI = new GoogleGenerativeAI(apiKey);
  return _genAI;
};

const aiClient = {
  /**
   * Complete a prompt using Gemini (Google AI).
   * @param {Object|string} input - Prompt text or object with .prompt/.text
   * @returns {Promise<{ text: string, usage: Object }>}
   */
  async complete(input) {
    try {
      console.log("🔍 aiClient.complete called with input type:", typeof input);

      // Handle string or object input
      let prompt = input;
      if (typeof input === "object" && input !== null) {
        if (input.prompt) {
          prompt = input.prompt;
        } else if (input.text) {
          prompt = input.text;
        } else {
          prompt = JSON.stringify(input);
        }
      }

      prompt = String(prompt || "").trim();

      if (!prompt || prompt.length === 0) {
        throw new Error("Prompt must be a non-empty string");
      }

      console.log("🤖 Prompt length:", prompt.length);

      // Lazy init — reads key from configService
      const genAI = await getGenAI();
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      console.log("✅ Gemini response received, length:", text.length);

      return {
        text: text,
        usage: {
          prompt_tokens: Math.ceil(prompt.length / 4),
          completion_tokens: Math.ceil(text.length / 4),
        },
      };
    } catch (error) {
      console.error("❌ Gemini Client Error:", {
        message: error.message,
        inputType: typeof input,
      });

      if (error.message.includes("API key") || error.message.includes("GEMINI_API_KEY") || error.message.includes("Required sensitive config")) {
        throw new Error("Gemini API key is invalid or missing. Configure it via admin panel or .env");
      }

      if (error.message.includes("rate limit") || error.message.includes("quota")) {
        throw new Error("Gemini API rate limit exceeded. Please try again later.");
      }

      if (error.message.includes("Prompt must be")) {
        throw new Error("Invalid prompt format provided to Gemini API.");
      }

      throw new Error("Gemini AI service failed. Please try again later.");
    }
  },
};

module.exports = aiClient;
