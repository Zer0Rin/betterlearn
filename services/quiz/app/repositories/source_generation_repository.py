import hashlib
import json
import uuid
from app.core.db import transaction
from app.core.exceptions import BankError
from app.models.question_source import canonical


async def create(user_id, request):
    encoded = canonical(request.model_dump())
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    with transaction() as cur:
        existing = cur.execute('SELECT * FROM quiz_source_tasks WHERE user_id=? AND request_id=?',
                               (user_id, request.request_id)).fetchone()
        if existing:
            if existing['request_digest'] != digest:
                raise BankError('请求 ID 已用于不同的出题参数', 409)
            return existing['task_id'], False
        task_id = 'task_' + uuid.uuid4().hex[:12]
        cur.execute("""INSERT INTO quiz_tasks(task_id,user_id,user_input,question_count,difficulty,status)
            VALUES(?,?,?,?,?,'pending')""",
            (task_id, user_id, request.user_input, request.question_count, request.difficulty))
        cur.execute('INSERT INTO quiz_source_tasks VALUES(?,?,?,?,?)',
                    (task_id, user_id, request.request_id, digest, encoded))
        return task_id, True


async def lookup(user_id, request_id):
    with transaction() as cur:
        row = cur.execute('SELECT task_id,request_json FROM quiz_source_tasks WHERE user_id=? AND request_id=?',
                          (user_id, request_id)).fetchone()
        if row is None:
            raise BankError('出题请求不存在', 404)
        return {'task_id': row['task_id'], 'request': json.loads(row['request_json'])}


async def claim(task_id):
    with transaction() as cur:
        row = cur.execute("""SELECT s.* FROM quiz_source_tasks s JOIN quiz_tasks t ON t.task_id=s.task_id
            WHERE s.task_id=? AND t.status='pending'""", (task_id,)).fetchone()
        if row is None:
            return None
        cur.execute("UPDATE quiz_tasks SET status='running' WHERE task_id=?", (task_id,))
        return dict(row)


async def fail(task_id, message):
    with transaction() as cur:
        cur.execute("""UPDATE quiz_tasks SET status='failed',error_message=?
            WHERE task_id=? AND status='running'""", (message, task_id))


async def check_status_owner(task_id, user_id):
    with transaction() as cur:
        row = cur.execute('SELECT user_id FROM quiz_source_tasks WHERE task_id=?', (task_id,)).fetchone()
        if row is not None and row['user_id'] != user_id:
            raise BankError('出题任务不存在', 404)
