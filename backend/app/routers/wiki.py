import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth import require_owner
from app.db import wiki_store
from app.services import sync

router = APIRouter(prefix="/api/wiki")


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: int | None = None


class FolderPatch(BaseModel):
    name: str | None = None
    parent_id: int | None = None


class PageCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    folder_id: int | None = None
    content: str = ""


class PagePatch(BaseModel):
    title: str | None = None
    folder_id: int | None = None


class PageUpdate(BaseModel):
    content: str
    note: str = ""


def _find_folder(folder_id: int) -> dict | None:
    return next((f for f in wiki_store.list_folders() if f["id"] == folder_id), None)


def _page_response(page_id: int) -> dict | None:
    page = wiki_store.get_page(page_id)
    if page is None:
        return None
    versions = wiki_store.list_versions(page_id)
    last_version = None
    if versions:
        v = versions[0]
        last_version = {
            "author": v["author"],
            "created_at": v["created_at"],
            "note": v["note"],
        }
    return {**page, "last_version": last_version}


@router.get("/tree")
async def get_tree() -> dict:
    return {"folders": wiki_store.list_folders(), "pages": wiki_store.list_pages()}


@router.post("/folders", status_code=201, dependencies=[Depends(require_owner)])
async def create_folder(body: FolderCreate) -> dict:
    if body.parent_id is not None and _find_folder(body.parent_id) is None:
        raise HTTPException(404, "Unknown parent folder.")
    try:
        folder = wiki_store.create_folder(body.name, body.parent_id)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A folder with that name already exists.")
    sync.schedule_push()
    return folder


@router.patch("/folders/{folder_id}", dependencies=[Depends(require_owner)])
async def patch_folder(folder_id: int, body: FolderPatch) -> dict:
    if _find_folder(folder_id) is None:
        raise HTTPException(404, "Unknown folder.")
    fields = body.model_dump(exclude_unset=True)
    if "parent_id" in fields and fields["parent_id"] is not None and _find_folder(fields["parent_id"]) is None:
        raise HTTPException(404, "Unknown parent folder.")
    try:
        if "name" in fields:
            wiki_store.rename_folder(folder_id, fields["name"])
        if "parent_id" in fields:
            wiki_store.move_folder(folder_id, fields["parent_id"])
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A folder with that name already exists.")
    except ValueError:
        raise HTTPException(404, "Unknown folder.")
    sync.schedule_push()
    return _find_folder(folder_id)


@router.delete("/folders/{folder_id}", status_code=204,
                dependencies=[Depends(require_owner)])
async def delete_folder(folder_id: int) -> None:
    if _find_folder(folder_id) is None:
        raise HTTPException(404, "Unknown folder.")
    try:
        wiki_store.delete_folder(folder_id)
    except ValueError:
        raise HTTPException(409, "Folder is not empty.")
    sync.schedule_push()


@router.post("/pages", status_code=201, dependencies=[Depends(require_owner)])
async def create_page(body: PageCreate) -> dict:
    try:
        page = wiki_store.create_page(body.title, body.folder_id, body.content,
                                      author="owner")
    except sqlite3.IntegrityError:
        raise HTTPException(404, "Unknown folder.")
    sync.schedule_push()
    return _page_response(page["id"])


@router.get("/pages/by-slug/{slug}")
async def get_page_by_slug(slug: str) -> dict:
    page = wiki_store.get_page_by_slug(slug)
    if page is None:
        raise HTTPException(404, "Unknown page.")
    return _page_response(page["id"])


@router.get("/pages/{page_id}")
async def get_page(page_id: int) -> dict:
    response = _page_response(page_id)
    if response is None:
        raise HTTPException(404, "Unknown page.")
    return response


@router.put("/pages/{page_id}", dependencies=[Depends(require_owner)])
async def update_page(page_id: int, body: PageUpdate) -> dict:
    if wiki_store.get_page(page_id) is None:
        raise HTTPException(404, "Unknown page.")
    wiki_store.update_page_content(page_id, body.content, author="owner",
                                   note=body.note)
    sync.schedule_push()
    return _page_response(page_id)


@router.patch("/pages/{page_id}", dependencies=[Depends(require_owner)])
async def patch_page(page_id: int, body: PagePatch) -> dict:
    if wiki_store.get_page(page_id) is None:
        raise HTTPException(404, "Unknown page.")
    fields = body.model_dump(exclude_unset=True)
    if "title" in fields:
        wiki_store.rename_page(page_id, fields["title"])
    if "folder_id" in fields:
        try:
            wiki_store.move_page(page_id, fields["folder_id"])
        except sqlite3.IntegrityError:
            raise HTTPException(404, "Unknown folder.")
    sync.schedule_push()
    return _page_response(page_id)


@router.delete("/pages/{page_id}", status_code=204,
                dependencies=[Depends(require_owner)])
async def delete_page(page_id: int) -> None:
    if wiki_store.get_page(page_id) is None:
        raise HTTPException(404, "Unknown page.")
    wiki_store.delete_page(page_id)
    sync.schedule_push()


@router.get("/pages/{page_id}/versions")
async def get_page_versions(page_id: int) -> dict:
    if wiki_store.get_page(page_id) is None:
        raise HTTPException(404, "Unknown page.")
    return {"versions": wiki_store.list_versions(page_id)}


@router.get("/versions/{version_id}")
async def get_version(version_id: int) -> dict:
    version = wiki_store.get_version(version_id)
    if version is None:
        raise HTTPException(404, "Unknown version.")
    return version


@router.post("/pages/{page_id}/restore/{version_id}",
             dependencies=[Depends(require_owner)])
async def restore_version(page_id: int, version_id: int) -> dict:
    if wiki_store.get_page(page_id) is None:
        raise HTTPException(404, "Unknown page.")
    version = wiki_store.get_version(version_id)
    if version is None or version["page_id"] != page_id:
        raise HTTPException(404, "Unknown version.")
    wiki_store.update_page_content(
        page_id, version["content"], author="owner",
        note=f"restored v{version_id}",
    )
    sync.schedule_push()
    return _page_response(page_id)


@router.get("/search")
async def search_pages(q: str = Query(..., min_length=1)) -> dict:
    return {"results": wiki_store.search_pages(q)}
