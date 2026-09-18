"""Question bank reads and organization.

Adapted from DeepTutor services/session/sqlite_store.py (Apache-2.0):
_escape_like, _question_bank_filters, _load_categories_for, paginated listing,
stats and category association queries. See third_party/DeepTutor/PROVENANCE.md.
Changes: per-user ownership, versioned canonical questions, immutable attempt
history, and an explicit bookmark-only mutation boundary.
"""
import json
import sqlite3
from app.core.db import transaction
from app.core.exceptions import BankError
from app.models.question_bank import BankQuery


def _escape_like(value: str) -> str:
    """Escape LIKE wildcards so a search term matches itself literally."""
    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def _entry(cur, user_id, entry_id):
    row = cur.execute('SELECT * FROM question_bank_entries WHERE id=? AND user_id=?', (entry_id, user_id)).fetchone()
    if row is None:
        raise BankError('题目或分类不存在', 404)
    return row


def _category(cur, user_id, category_id):
    row = cur.execute('SELECT * FROM question_bank_categories WHERE id=? AND user_id=?', (category_id, user_id)).fetchone()
    if row is None:
        raise BankError('题目或分类不存在', 404)
    return row


def _question_bank_filters(user_id, query):
    # Shared by list + count, adapted from DeepTutor. All values bind via ?.
    joins, conditions, params = [], ['n.user_id=?'], [user_id]
    if query.category_id is not None:
        joins.append(' INNER JOIN question_bank_entry_categories ec ON ec.entry_id=n.id')
        conditions.append('ec.category_id=?')
        params.append(query.category_id)
    elif query.scope == 'uncategorized':
        conditions.append('NOT EXISTS (SELECT 1 FROM question_bank_entry_categories ec WHERE ec.entry_id=n.id)')
    if query.scope == 'wrong':
        conditions.append('n.is_correct=0')
    elif query.scope == 'ever_wrong':
        conditions.append('n.wrong_count>0')
    elif query.scope == 'bookmarked':
        conditions.append('n.bookmarked=1')
    if query.quiz_id is not None:
        conditions.append('n.quiz_id=?')
        params.append(query.quiz_id)
    if query.search:
        needle = f'%{_escape_like(query.search)}%'
        conditions.append("(n.stem LIKE ? ESCAPE '\\' OR n.explanation LIKE ? ESCAPE '\\' OR n.knowledge_point LIKE ? ESCAPE '\\')")
        params.extend([needle] * 3)
    return ''.join(joins), ' WHERE ' + ' AND '.join(conditions), params


def _load_categories_for(cur, user_id, entry_ids):
    if not entry_ids:
        return {}
    placeholders = ','.join('?' for _ in entry_ids)
    rows = cur.execute(f'''SELECT ec.entry_id,c.id,c.name FROM question_bank_entry_categories ec
        JOIN question_bank_categories c ON c.id=ec.category_id
        WHERE c.user_id=? AND ec.entry_id IN ({placeholders}) ORDER BY c.name,c.id''', [user_id, *entry_ids]).fetchall()
    grouped = {}
    for row in rows:
        grouped.setdefault(row['entry_id'], []).append({'id': row['id'], 'name': row['name']})
    return grouped


def _serialize(row):
    result = dict(row)
    result['question'] = json.loads(result.pop('question_json'))
    for field in ('user_id', 'stem', 'explanation', 'knowledge_point'):
        result.pop(field)
    result['is_correct'] = bool(result['is_correct']) if result['is_correct'] is not None else None
    result['bookmarked'] = bool(result['bookmarked'])
    return result


async def list_entries(user_id: int, query: BankQuery):
    with transaction() as cur:
        if query.category_id is not None:
            _category(cur, user_id, query.category_id)
        if query.quiz_id is not None and not cur.execute('SELECT 1 FROM quiz_sessions WHERE quiz_id=? AND user_id=?', (query.quiz_id, user_id)).fetchone():
            raise BankError('题卷不存在', 404)
        joins, where, params = _question_bank_filters(user_id, query)
        total = cur.execute('SELECT COUNT(*) FROM question_bank_entries n' + joins + where, params).fetchone()[0]
        order = 'ASC' if query.sort == 'oldest' else 'DESC'
        rows = cur.execute('SELECT n.* FROM question_bank_entries n' + joins + where +
            f' ORDER BY n.created_at {order}, n.id {order} LIMIT ? OFFSET ?',
            [*params, query.page_size, (query.page - 1) * query.page_size]).fetchall()
        items = [_serialize(row) for row in rows]
        categories = _load_categories_for(cur, user_id, [r['id'] for r in rows])
        from app.repositories.question_source_repository import sources_for
        sources = sources_for(cur, [r['id'] for r in rows])
        for item in items:
            item.update(sources.get(item['id'], {'source': None, 'source_revision': 0}))
            item['categories'] = categories.get(item['id'], [])
        return {'items': items, 'total': total, 'page': query.page, 'page_size': query.page_size}


async def get_entry(user_id, entry_id):
    with transaction() as cur:
        item = _serialize(_entry(cur, user_id, entry_id))
        item['categories'] = _load_categories_for(cur, user_id, [entry_id]).get(entry_id, [])
        from app.repositories.question_source_repository import current_source
        item.update(current_source(cur, entry_id))
        return item


async def stats(user_id):
    with transaction() as cur:
        row = cur.execute('''SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN n.is_correct=0 THEN 1 ELSE 0 END),0) AS wrong,
            COALESCE(SUM(CASE WHEN n.wrong_count>0 THEN 1 ELSE 0 END),0) AS ever_wrong,
            COALESCE(SUM(n.bookmarked),0) AS bookmarked,
            COALESCE(SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM question_bank_entry_categories ec
                WHERE ec.entry_id=n.id) THEN 1 ELSE 0 END),0) AS uncategorized
            FROM question_bank_entries n WHERE n.user_id=?''', (user_id,)).fetchone()
        return dict(row)


async def history(user_id, entry_id, page, page_size):
    with transaction() as cur:
        entry = _entry(cur, user_id, entry_id)
        total = cur.execute('SELECT COUNT(*) FROM question_bank_attempts WHERE entry_id=?', (entry_id,)).fetchone()[0]
        rows = cur.execute('''SELECT a.attempt_id,a.submitted_at,r.selected_answers_json,r.is_correct,r.duration_ms,b.source_json,b.source_revision
            FROM question_bank_attempts b JOIN quiz_attempts a ON a.attempt_id=b.attempt_id
            JOIN quiz_attempt_answers r ON r.attempt_id=a.attempt_id AND r.question_id=?
            WHERE b.entry_id=? AND a.user_id=? ORDER BY b.id DESC LIMIT ? OFFSET ?''',
            (entry['question_id'], entry_id, user_id, page_size, (page - 1) * page_size)).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            source = item.pop('source_json')
            item['source'] = json.loads(source) if source else None
            item['selected_answers'] = json.loads(item.pop('selected_answers_json'))
            item['is_correct'] = bool(item['is_correct'])
            items.append(item)
        return {'items': items, 'total': total, 'page': page, 'page_size': page_size}


async def bookmark(user_id, entry_id, value):
    with transaction() as cur:
        _entry(cur, user_id, entry_id)
        cur.execute('UPDATE question_bank_entries SET bookmarked=? WHERE id=?', (int(value), entry_id))
    return {'id': entry_id, 'bookmarked': value}


async def list_categories(user_id):
    with transaction() as cur:
        return [dict(r) for r in cur.execute('''SELECT c.id,c.name,COUNT(ec.entry_id) AS entry_count
            FROM question_bank_categories c LEFT JOIN question_bank_entry_categories ec ON ec.category_id=c.id
            WHERE c.user_id=? GROUP BY c.id ORDER BY c.name,c.id''', (user_id,)).fetchall()]


async def save_category(user_id, name, category_id=None):
    with transaction() as cur:
        if category_id is not None:
            _category(cur, user_id, category_id)
        try:
            if category_id is None:
                cur.execute('INSERT INTO question_bank_categories(user_id,name,name_key) VALUES (?,?,?)',
                            (user_id, name, name.casefold()))
                category_id = cur.lastrowid
            else:
                cur.execute('UPDATE question_bank_categories SET name=?,name_key=? WHERE id=?',
                            (name, name.casefold(), category_id))
        except sqlite3.IntegrityError:
            raise BankError('该分类名称已存在', 409) from None
        return {'id': category_id, 'name': name}


async def delete_category(user_id, category_id):
    with transaction() as cur:
        _category(cur, user_id, category_id)
        cur.execute('DELETE FROM question_bank_categories WHERE id=?', (category_id,))
        return {'id': category_id}


async def categorize(user_id, entry_id, category_id, linked):
    with transaction() as cur:
        _entry(cur, user_id, entry_id)
        _category(cur, user_id, category_id)
        if linked:
            cur.execute('INSERT OR IGNORE INTO question_bank_entry_categories VALUES (?,?)', (entry_id, category_id))
        else:
            cur.execute('DELETE FROM question_bank_entry_categories WHERE entry_id=? AND category_id=?', (entry_id, category_id))
        return {'entry_id': entry_id, 'category_id': category_id, 'linked': linked}
