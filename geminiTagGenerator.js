// geminiTagGenerator.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateTagsWithGemini(title, url) {
  try {
    const prompt = `Extract 5 relevant tags from this news article.
Title: "${title}"
URL: "${url}"
Return only a comma-separated list of tags (no sentences).`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);

    const text = result.response.text().trim();
    return text.split(",").map(tag => tag.trim().toLowerCase());
  } catch (err) {
    console.error("Gemini tag generation error:", err.message);

    // fallback simple tags
    return title
      .split(" ")
      .filter(word => word.length > 4)
      .slice(0, 5)
      .map(w => w.toLowerCase());
  }
}

module.exports = { generateTagsWithGemini };
