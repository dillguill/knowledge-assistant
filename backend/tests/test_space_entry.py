import httpx


async def test_space_entry_serves_status_page_and_api():
    from app_space import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        health = await client.get("/api/health")
        assert health.status_code == 200
        root = await client.get("/", follow_redirects=True)
        assert root.status_code == 200
