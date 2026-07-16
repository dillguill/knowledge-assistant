"""Hugging Face Space entrypoint.

The free Space tier only offers the Gradio SDK, so the FastAPI app is served
by mounting a minimal Gradio status page onto it and running uvicorn on the
port the Space expects (7860).
"""

import gradio as gr

from app.main import create_app

FRONTEND_URL = "https://dillguill.github.io/knowledge-assistant/"

app = create_app()

with gr.Blocks(title="Knowledge Assistant API") as status_page:
    gr.Markdown(
        f"""
# Knowledge Assistant API

This Space hosts the backend for **[Knowledge Assistant]({FRONTEND_URL})** —
open the frontend to chat.

- Frontend: [{FRONTEND_URL}]({FRONTEND_URL})
- Health: [/api/health](/api/health)
- Models: [/api/models](/api/models)
"""
    )

app = gr.mount_gradio_app(app, status_page, path="/")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=7860)
