import sqlite3

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.auth import require_owner
from app.config import get_settings
from app.db import store
from app.services.ingestion import UnsupportedFileType, extract_text

router = APIRouter(prefix="/api/knowledge")


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


@router.post("/collections", status_code=201,
             dependencies=[Depends(require_owner)])
async def create_collection(body: CollectionCreate) -> dict:
    try:
        return store.create_collection(body.name)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A collection with that name already exists.")


@router.get("/collections")
async def get_collections() -> dict:
    return {"collections": store.list_collections()}


@router.post("/collections/{collection_id}/files", status_code=201,
             dependencies=[Depends(require_owner)])
async def upload_file(collection_id: int, file: UploadFile) -> dict:
    if not any(c["id"] == collection_id for c in store.list_collections()):
        raise HTTPException(404, "Unknown collection.")
    raw = await file.read()
    try:
        text = extract_text(file.filename or "upload",
                            file.content_type or "", raw)
    except UnsupportedFileType as exc:
        raise HTTPException(415, str(exc))
    return store.add_document(collection_id, file.filename or "upload",
                              file.content_type or "application/octet-stream",
                              "upload", raw, text)


@router.get("/collections/{collection_id}/files")
async def get_files(collection_id: int) -> dict:
    return {"files": store.list_documents(collection_id)}


@router.get("/files/{doc_id}/raw")
async def get_raw(doc_id: int) -> FileResponse:
    doc = store.get_document(doc_id)
    if doc is None:
        raise HTTPException(404, "Unknown file.")
    return FileResponse(store.get_document_path(doc),
                        media_type=doc["content_type"],
                        filename=doc["filename"])


attachments_router = APIRouter()


@attachments_router.post("/api/attachments", status_code=201)
async def upload_attachment(file: UploadFile) -> dict:
    raw = await file.read()
    settings = get_settings()
    if len(raw) > settings.attachment_max_bytes:
        raise HTTPException(413, "Attachment is too large.")
    try:
        text = extract_text(file.filename or "attachment",
                            file.content_type or "", raw)
    except UnsupportedFileType as exc:
        raise HTTPException(415, str(exc))
    doc = store.add_document(None, file.filename or "attachment",
                             file.content_type or "application/octet-stream",
                             "attachment", raw, text)
    return {"id": doc["id"], "filename": doc["filename"]}
