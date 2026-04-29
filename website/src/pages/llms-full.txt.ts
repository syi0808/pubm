import { renderLlmsFullTxt, textResponse } from "../llms";

export async function GET() {
  return textResponse(await renderLlmsFullTxt());
}
