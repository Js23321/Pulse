// Recursively converts Gemini-style uppercase JSON Schema types to lowercase
// e.g. { type: "OBJECT", properties: { x: { type: "STRING" } } }
//   -> { type: "object", properties: { x: { type: "string" } } }
function normaliseSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const out = { ...schema };
  if (typeof out.type === "string") out.type = out.type.toLowerCase();
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, normaliseSchema(v)])
    );
  }
  if (out.items) out.items = normaliseSchema(out.items);
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const defaultModel = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";

  if (!apiKey) {
    res.status(500).json({ error: "Missing OPENROUTER_API_KEY" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const toolDeclarations = Array.isArray(body.tools) && body.tools.length > 0 ? body.tools : null;
    const requestModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : defaultModel;

    // OpenAI-compatible message format (OpenRouter accepts this directly)
    const formattedMessages = messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
      content: m.content || "",
    }));

    const requestBody = {
      model: requestModel,
      messages: formattedMessages,
      max_tokens: toolDeclarations ? 800 : 300,
      temperature: 0.7,
    };

    // Convert Gemini-format function declarations to OpenAI tool format
    if (toolDeclarations) {
      requestBody.tools = toolDeclarations.map((fn) => ({
        type: "function",
        function: {
          name: fn.name,
          description: fn.description || "",
          parameters: normaliseSchema(fn.parameters) || { type: "object", properties: {} },
        },
      }));
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://pulse.sciencerevisions.online",
        "X-Title": "Pulse",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(500).json({ error: "OpenRouter request failed", details: data });
      return;
    }

    const message = data?.choices?.[0]?.message;
    const reply = message?.content || null;

    // Parse OpenAI-format tool calls back to our internal { name, args } format
    const actions = [];
    if (Array.isArray(message?.tool_calls)) {
      for (const tc of message.tool_calls) {
        if (tc.type === "function") {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
          actions.push({ name: tc.function.name, args });
        }
      }
    }

    if (!reply && actions.length === 0) {
      res.status(500).json({ error: "Empty response from OpenRouter", details: data });
      return;
    }

    res.status(200).json({ reply, actions });
  } catch (error) {
    res.status(500).json({ error: "Unexpected server error", details: error?.message || String(error) });
  }
};
