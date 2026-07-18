"""Hugging Face Space entrypoint.

The free Space tier serves the Gradio SDK on ZeroGPU hardware. We build on
``gradio.Server`` — a FastAPI subclass with Gradio's launch engine baked in — so
our FastAPI routes and a status page are served, and ``app.launch()`` is the
Gradio-native launch the Space expects. ZeroGPU additionally refuses to start
unless the app defines at least one ``@spaces.GPU`` function (see below).
"""

import os

from fastapi.responses import HTMLResponse
from gradio import Server

from app.main import _startup, configure

FRONTEND_URL = "https://dillguill.github.io/knowledge-assistant/"

app = Server()
configure(app)
# gradio.Server manages its own lifespan, so run our startup work explicitly at
# module import (how the Space executes this file) rather than via a FastAPI
# lifespan we'd risk clobbering.
_startup()

# ZeroGPU Spaces fail at startup with "No @spaces.GPU function detected" unless
# the app defines at least one @spaces.GPU function. This backend does no GPU
# work, so this never-called stub exists only to satisfy that requirement.
# `spaces` is force-installed by HF on the Space but is absent locally / in tests.
try:
    import spaces

    @spaces.GPU
    def _zerogpu_startup_probe() -> None:
        return None

except ImportError:
    pass


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
# importing the module in tests/local tooling doesn't start a server.
if os.environ.get("SPACE_ID") or __name__ == "__main__":
    app.launch(show_error=True)
