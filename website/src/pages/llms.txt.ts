import { renderLlmsTxt, textResponse } from "../llms";

export async function GET() {
  return textResponse(await renderLlmsTxt());
}
