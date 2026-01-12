// services/ai/aiInsightService.js
const aiClient = require("../../utils/aiClient");

/**
 * Extract JSON from AI response that may be wrapped in markdown code blocks
 */
function extractJSON(text) {
  if (!text) return null;
  
  // Remove markdown code blocks if present (```json ... ``` or ``` ... ```)
  let cleaned = text.trim();
  
  // Match ```json or ``` at start and ``` at end
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }
  
  // Try to find JSON object in the text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  
  return cleaned;
}

exports.analyzeResponse = async ({ response, survey }) => {
  const text = [
    response.review,
    ...(response.answers || []).map(a => a.answer)
  ]
    .filter(Boolean)
    .join(" ");

  console.log(`\n🧠 [AIInsight] Analyzing response...`);
  console.log(`   Text length: ${text?.length || 0} chars`);
  console.log(`   Text preview: "${text?.substring(0, 100)}..."`);

  if (!text) {
    console.log(`   ⚠️ No text to analyze, returning defaults`);
    return {
      sentiment: "neutral",
      shouldGenerateAction: false,
      urgency: "low"
    };
  }

  const aiResult = await aiClient.complete({
    prompt: `
Analyze customer feedback and return JSON only (no markdown):

{
  "sentiment": "positive|neutral|negative",
  "sentimentScore": number (-1 to 1),
  "urgency": "low|medium|high",
  "shouldGenerateAction": boolean,
  "summary": "short issue summary",
  "emotions": ["frustration", "appreciation", etc],
  "keywords": ["keyword1", "keyword2"],
  "themes": ["theme1", "theme2"],
  "classification": {
    "isComplaint": boolean,
    "isPraise": boolean,
    "isSuggestion": boolean
  }
}

Feedback:
"${text}"
    `,
    maxTokens: 400
  });

  try {
    const rawText = aiResult.text;
    console.log(`   📥 Raw AI response: ${rawText?.substring(0, 150)}...`);
    
    const cleanedJSON = extractJSON(rawText);
    console.log(`   🧹 Cleaned JSON: ${cleanedJSON?.substring(0, 150)}...`);
    
    const parsed = JSON.parse(cleanedJSON);
    console.log(`   ✅ Parsed successfully:`, JSON.stringify(parsed));
    
    return parsed;
  } catch (err) {
    console.error(`   ❌ JSON parse failed: ${err.message}`);
    console.error(`   Raw text was: ${aiResult.text}`);
    return {
      sentiment: "neutral",
      shouldGenerateAction: false,
      urgency: "low"
    };
  }
};