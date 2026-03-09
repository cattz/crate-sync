import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * Start a temporary HTTP server to receive the OAuth callback.
 * Returns the authorization code extracted from the `?code=` query parameter.
 */
export function waitForAuthCallback(port: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body><h1>Authorization failed</h1><p>${error}</p></body></html>`);
        server.close();
        reject(new Error(`Spotify authorization denied: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h1>Missing authorization code</h1></body></html>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><h1>Success!</h1><p>You can close this window.</p></body></html>",
      );

      server.close();
      resolve(code);
    });

    server.on("error", reject);
    server.listen(port);
  });
}
