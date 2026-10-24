import { defineEventHandler, setHeader } from "h3";

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", "text/html; charset=utf-8");
  setHeader(event, "Cache-Control", "public, max-age=300");
  setHeader(event, "X-Content-Type-Options", "nosniff");
  return [
    "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Connect an AI client to MVM3D</title>",
    "<style>*{box-sizing:border-box}body{margin:0;background:#070c11;color:#eaf2f8;font:15px/1.65 system-ui,-apple-system,sans-serif;padding:24px}main{max-width:820px;margin:5vh auto;border:1px solid #273a45;border-radius:22px;padding:clamp(22px,5vw,42px);background:radial-gradient(circle at 100% 0,#173a35 0,transparent 36%),#0c141d}a{color:#83f0ce}h1{font-size:clamp(30px,5vw,46px);line-height:1.08;letter-spacing:-.04em;margin:16px 0}h2{font-size:18px;margin-top:32px}p,li{color:#a8b6c3}code,.url{color:#83f0ce;background:#060b10;border:1px solid #20323b;border-radius:8px;padding:3px 7px;overflow-wrap:anywhere}.url{display:block;margin:18px 0;padding:16px;border-radius:12px;border:1px solid #83f0ce44;background:#060b10;font-size:14px}.note{padding:14px;border:1px solid #83f0ce33;border-radius:12px;background:#83f0ce0a}</style></head><body><main>",
    "<p style='color:#83f0ce;font-size:11px;letter-spacing:.2em;font-weight:800'>MVM 3D FORGE · REMOTE MCP</p><h1>Connect your AI client</h1>",
    "<p>Use OAuth to connect ChatGPT, Claude, or a compatible custom MCP client to your own MVM3D workspace. You do not need to pre-create an MVM3D API key.</p>",
    "<code class='url'>https://mvm3d.vercel.app/mcp</code><h2>How the connection works</h2><ol>",
    "<li>Add a custom remote MCP connector in your AI client and paste the URL above.</li><li>Choose OAuth authentication. If asked how to register the OAuth client, choose Register automatically or the equivalent dynamic-registration option.</li>",
    "<li>The client opens MVM3D sign-in. Sign in or <a href='/login'>create an account</a>.</li><li>Review the permission checkboxes on the MVM3D consent screen and press Connect MVM3D. Uncheck any permission you do not want to grant.</li>",
    "<li>Return to your AI client and test a read-only action such as listing your projects before allowing scene edits.</li></ol><h2>Permissions you may approve</h2><ul>",
    "<li><code>project:read</code> — view saved projects and scene data.</li><li><code>scene:write</code> — create projects and edit scene objects.</li><li><code>scene:execute</code> — run scripts in the Studio sandbox and read diagnostics.</li>",
    "<li><code>assets:export</code> — export an authorized scene as GLB.</li><li><code>offline_access</code> — allow the client to refresh its access token without another sign-in every hour.</li></ul>",
    "<div class='note'><strong>Important:</strong> OAuth connects an AI client to MVM3D tools; it does not connect an OpenAI, Anthropic, Gemini or xAI model-provider API key. Prompt-driven scene scripting lives separately at <a href='/Prompt2Model'>/Prompt2Model</a>. Scripts are not executed automatically.</div>",
    "<h2>Technical details</h2><p>The server exposes OAuth authorization-server and protected-resource metadata, dynamic client registration, authorization code with PKCE S256, issuer identification, scoped access tokens, and rotating refresh tokens. If connector setup fails, inspect:</p><ul>",
    "<li><a href='/.well-known/oauth-protected-resource/mcp'>Protected resource metadata</a></li><li><a href='/.well-known/oauth-authorization-server'>Authorization server metadata</a></li></ul>",
    "<p><a href='/'>MVM3D home</a> · <a href='/studio'>Open Studio</a></p></main></body></html>"
  ].join("");
});
