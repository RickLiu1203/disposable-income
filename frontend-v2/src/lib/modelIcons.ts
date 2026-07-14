import claude from "../assets/icons/claude.svg"
import gemini from "../assets/icons/gemini.svg"
import grok from "../assets/icons/grok.svg"
import openai from "../assets/icons/openai.svg"

interface ModelIconInfo {
  icon?: string
  badge: string
}

const MODEL_ICONS: Record<string, ModelIconInfo> = {
  "sonnet-5": { icon: claude, badge: "S5" },
  "opus-4.8": { icon: claude, badge: "O4" },
  "gemini-3.5-flash": { icon: gemini, badge: "GM" },
  "grok-4.5": { icon: grok, badge: "GK" },
  "gpt-5.6-terra": { icon: openai, badge: "GT" },
}

export function getModelIcon(modelName: string): ModelIconInfo {
  return MODEL_ICONS[modelName] ?? { badge: modelName.slice(0, 2).toUpperCase() }
}
