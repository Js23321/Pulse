module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

  if (!apiKey) {
    res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const requestModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : model;

    const prompt = messages
      .map((message) => {
        const role = message.role === "assistant" ? "Assistant" : message.role === "system" ? "System" : "User";
        return `${role}: ${message.content || ""}`;
      })
      .join("\n\n");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requestModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.7,
          },
        }),
      }
    );

    const data = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!response.ok || !reply) {
      res.status(500).json({ error: "Gemini request failed", details: data });
      return;
    }

    res.status(200).json({ reply });
  } catch (error) {
    res.status(500).json({ error: "Unexpected server error", details: error?.message || String(error) });
  }
};
