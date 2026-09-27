import Anthropic from "@anthropic-ai/sdk";
if (!process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ||
    !process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"]) {
    throw new Error("The Anthropic AI integration has not been provisioned.");
}
export const anthropic = new Anthropic({
    apiKey: process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"],
    baseURL: process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"],
});
