module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

  if (!apiKey) {
    res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const toolDeclarations = Array.isArray(body.tools) && body.tools.length > 0 ? body.tools : null;
    const requestModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : model;

    // Separate system message from chat messages
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMsgs = messages.filter((m) => m.role !== "system");

    // Build Gemini-format contents (must alternate user/model, must start with user)
    const contents = chatMsgs.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content || "" }],
    }));

    // Gemini requires at least one user turn
    if (!contents.length || contents[0].role !== "user") {
      contents.unshift({ role: "user", parts: [{ text: "(start)" }] });
    }

    const requestBody = {
      contents,
      generationConfig: {
        maxOutputTokens: toolDeclarations ? 800 : 300,
        temperature: 0.7,
      },
    };

    if (systemMsg?.content) {
      requestBody.system_instruction = { parts: [{ text: systemMsg.content }] };
    }

    if (toolDeclarations) {
      requestBody.tools = [{ function_declarations: toolDeclarations }];
      requestBody.tool_config = { function_calling_config: { mode: "AUTO" } };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requestModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      res.status(500).json({ error: "Gemini request failed", details: data });
      return;
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p) => typeof p.text === "string");
    const fnParts = parts.filter((p) => p.functionCall);

    const reply = textPart?.text || null;
    const actions = fnParts.map((p) => ({
      name: p.functionCall.name,
      args: p.functionCall.args || {},
    }));

    if (!reply && actions.length === 0) {
      res.status(500).json({ error: "Empty response from Gemini", details: data });
      return;
    }

    res.status(200).json({ reply, actions });
  } catch (error) {
    res.status(500).json({ error: "Unexpected server error", details: error?.message || String(error) });
  }
};
