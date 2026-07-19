"""Seeds a starter wiki page on first boot so the deployed wiki is never empty."""

from app.db import wiki_store

_WELCOME_CONTENT = """\
This wiki is where the durable knowledge lives: not the back-and-forth of a \
chat, but the settled answers worth keeping around. Anything written down \
here stays put until someone deliberately changes it.

## How pages change

Pages are edited two ways. You can type directly into a page and save, which \
records a new version right away. Or, when a proposal comes out of a \
conversation, it shows up as a diff against the current page rather than \
overwriting anything. You review the diff, then approve or reject it. Nothing \
lands on a page without that step.

```mermaid
flowchart LR
    A[Propose change] --> B[Review diff]
    B -->|approve| C[New version saved]
    B -->|reject| D[Discarded]
```

Every saved version is kept, so you can always look back at what a page used \
to say and who changed it.

## Finding your way around

Pages link to each other with double brackets, like this link back to \
[[Welcome to the Wiki]]. A link to a page that does not exist yet, such as \
[[Reading List]], still renders — it just looks different until someone \
creates that page.

Pages also render a bit of math and a few other formats inline. For example, \
the mass-energy relation is written $E = mc^2$, and the note below sums up \
what this page demonstrates:

| Feature | Shown above |
|---|---|
| Section headings | Yes |
| Wiki links | Yes |
| Diagram | Yes |
| Inline math | Yes |

## Before you start writing

- [x] Read this page
- [ ] Create a `Reading List` page
- [ ] Organize folders to match how you think about the material

There is no required structure. Start with one folder, or none at all, and \
let it grow into whatever shape makes sense for what you are keeping track \
of.
"""


def seed_wiki() -> None:
    if wiki_store.list_pages():
        return
    folder = wiki_store.create_folder("Guides", None)
    wiki_store.create_page(
        "Welcome to the Wiki", folder["id"], _WELCOME_CONTENT, "owner"
    )
