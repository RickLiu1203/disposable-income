import fs from "fs";
import path from "path";

// Resolves correctly in both dev (tsx watch, this file runs from src/agent/)
// and prod (compiled to dist/agent/) since both sit exactly two directories
// below backend/, where the prompt file actually lives.
const PROMPT_PATH = path.join(__dirname, "..", "..", "prediction-market-agent-system-prompt.md");

/** Renders the agent system prompt with {{CURRENT_EVENT_ID}}, {{YOUR_MODEL_NAME}},
 * and {{BACKEND_BASE_URL}} substituted -- other template values (if any) are left untouched. */
export function renderSystemPrompt(eventId: string, modelName: string, backendBaseUrl?: string): string {
  const raw = fs.readFileSync(PROMPT_PATH, "utf-8");
  const baseUrl = backendBaseUrl || "http://localhost:3000";
  return raw
    .replaceAll("{{CURRENT_EVENT_ID}}", eventId)
    .replaceAll("{{YOUR_MODEL_NAME}}", modelName)
    .replaceAll("{{BACKEND_BASE_URL}}", baseUrl);
}
