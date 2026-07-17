"""Hugging Face Space entrypoint.

The free Space tier serves the Gradio SDK, which launches the app itself on port
7860 (and, on ZeroGPU, alongside the injected ``spaces`` runtime). A plain
FastAPI app + our own ``uvicorn.run`` double-binds that port, so instead we build
on ``gradio.Server`` — a FastAPI subclass with Gradio's launch engine baked in.
It serves our API routes and a status page, and ``app.launch()`` is the
Gradio-native launch the Space expects.
"""

import os

from fastapi.responses import HTMLResponse
from gradio import Server

from app.main import configure

FRONTEND_URL = "https://dillguill.github.io/knowledge-assistant/"

app = Server()
configure(app)


@app.get("/", response_class=HTMLResponse)
async def status_page() -> str:
    return f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Knowledge Assistant API</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem;">
  <h1>Knowledge Assistant API</h1>
  <p>Backend for <strong><a href="{FRONTEND_URL}">Knowledge Assistant</a></strong> —
     open the frontend to chat.</p>
  <ul>
    <li>Frontend: <a href="{FRONTEND_URL}">{FRONTEND_URL}</a></li>
    <li>Health: <a href="/api/health">/api/health</a></li>
    <li>Models: <a href="/api/models">/api/models</a></li>
  </ul>
</body>
</html>"""


# The Space imports this module in Gradio reload mode (so __name__ != "__main__"),
# which is why launch() must run at module level — matching the canonical
# gradio.Server Space example (ysharma/text-behind-image). Gate on SPACE_ID so
# importing the module in tests/local tooling doesn't start a server. ssr_mode=False
# skips gradio 6's Node.js SSR proxy, which fails to stay up on the Space.
if os.environ.get("SPACE_ID") or __name__ == "__main__":
    app.launch(show_error=True, ssr_mode=False)
