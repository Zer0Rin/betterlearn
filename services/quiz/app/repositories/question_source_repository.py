"""Version-guarded source mapping; answer history freezes its own snapshot."""
import json
from app.core.db import transaction
from app.core.exceptions import BankError
from app.models.question_source import canonical
from app.repositories.question_bank_repository import _entry


def sources_for(cur, ids):
    if not ids:
        return {}
    placeholders = ','.join('?' for _ in ids)
    return {r['entry_id']: {'source_revision': r['revision'],
            'source': json.loads(r['source_json']) if r['source_json'] else None}
            for r in cur.execute(f'SELECT * FROM question_bank_sources WHERE entry_id IN ({placeholders})', ids)}


def current_source(cur, entry_id):
    return sources_for(cur, [entry_id]).get(entry_id, {'source': None, 'source_revision': 0})


async def get_source(user_id, entry_id):
    with transaction() as cur:
        _entry(cur, user_id, entry_id)
        return current_source(cur, entry_id)


async def update_source(user_id, entry_id, request):
    source = request.source.model_dump() if request.source is not None else None
    with transaction() as cur:
        _entry(cur, user_id, entry_id)
        current = current_source(cur, entry_id)
        revision = current['source_revision']
        # A lost response may be retried; intervening edits still conflict.
        if revision == request.expected_revision + 1 and current['source'] == source:
            return current
        if revision != request.expected_revision:
            raise BankError('来源关联已变化，请重新读取后操作', 409)
        cur.execute('''INSERT INTO question_bank_sources(entry_id,revision,source_json) VALUES(?,?,?)
            ON CONFLICT(entry_id) DO UPDATE SET revision=excluded.revision,source_json=excluded.source_json''',
            (entry_id, revision + 1, canonical(source) if source is not None else None))
        return {'source': source, 'source_revision': revision + 1}
