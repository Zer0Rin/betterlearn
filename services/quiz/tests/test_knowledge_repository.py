"""Knowledge repository contracts against SQLite."""
import pytest
from app.repositories import knowledge_repository as docs, user_repository as users


@pytest.mark.asyncio
async def test_document_lifecycle_and_ownership(database):
    uid = (await users.create_user('test'))['id']
    assert await docs.count_documents(uid) == 0
    assert await docs.get_document('missing', uid) is None
    await docs.create_document('doc_1', uid, 'a.pdf', 'pdf', 1024)
    assert (await docs.get_document('doc_1', uid))['status'] == 'processing'
    await docs.update_document_status('doc_1', 'ready', chunk_count=5)
    document = await docs.get_document('doc_1', uid)
    assert document['chunk_count'] == 5 and document['status'] == 'ready'
    assert document['created_at']
    await docs.create_document('doc_2', uid, 'b.docx', 'docx', 2048)
    assert len(await docs.list_documents(uid)) == 2
    assert await docs.count_documents(uid) == 2
    assert await docs.get_document('doc_1', uid + 1) is None
    await docs.delete_document('doc_1', uid + 1)
    assert await docs.count_documents(uid) == 2
    await docs.delete_document('doc_1', uid)
    assert await docs.count_documents(uid) == 1
