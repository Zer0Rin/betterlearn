"""User repository contracts against SQLite."""
import asyncio
import pytest
from app.repositories import user_repository as users


@pytest.mark.asyncio
async def test_get_or_create_user_uses_atomic_unique_key_upsert(database):
    results = await asyncio.gather(*(users.get_or_create_user('local:web-single-user') for _ in range(12)))
    assert len({result['id'] for result in results}) == 1
    user = results[0]
    await users.update_user_profile(user['id'], 'Name', 'avatar')
    await users.add_user_xp(user['id'], 12)
    stored = await users.find_user_by_openid('local:web-single-user')
    assert stored['nickname'] == 'Name'
    assert stored['avatar_url'] == 'avatar'
    assert stored['total_xp'] == 12
