import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def connect(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def column_exists(conn, table_name: str, column_name: str) -> bool:
    info = conn.execute(f'PRAGMA table_info({table_name})').fetchall()
    return any(row['name'] == column_name for row in info)


def add_column_if_missing(conn, table_name: str, column_name: str, column_sql: str) -> None:
    if not column_exists(conn, table_name, column_name):
        conn.execute(f'ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}')


def run_migrations(conn):
    add_column_if_missing(conn, 'submissions', 'submission_hash', 'TEXT')
    add_column_if_missing(conn, 'submissions', 'submission_count', 'INTEGER NOT NULL DEFAULT 1')
    add_column_if_missing(conn, 'submissions', 'locked_at', 'TEXT')
    add_column_if_missing(conn, 'biometric_records', 'session_id', 'INTEGER')
    add_column_if_missing(conn, 'incidents', 'workflow_status', "TEXT NOT NULL DEFAULT 'new'")
    add_column_if_missing(conn, 'incidents', 'workflow_updated_at', 'TEXT')
    add_column_if_missing(conn, 'incidents', 'workflow_note', 'TEXT')
    add_column_if_missing(conn, 'incidents', 'confidence_score', 'REAL')
    add_column_if_missing(conn, 'incidents', 'detector_family', 'TEXT')
    add_column_if_missing(conn, 'incidents', 'triggered_rules_json', "TEXT NOT NULL DEFAULT '[]'")
    add_column_if_missing(conn, 'incidents', 'evidence_vector_json', "TEXT NOT NULL DEFAULT '{}'")
    add_column_if_missing(conn, 'incidents', 'dedupe_key', 'TEXT')
    add_column_if_missing(conn, 'incidents', 'retention_days', 'INTEGER')
    add_column_if_missing(conn, 'incidents', 'evidence_expires_at', 'TEXT')
    add_column_if_missing(conn, 'incidents', 'policy_version', 'TEXT')
    add_column_if_missing(conn, 'incidents', 'assignee', 'TEXT')
    add_column_if_missing(conn, 'incidents', 'sla_due_at', 'TEXT')
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS privacy_consents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            policy_version TEXT NOT NULL,
            policy_hash TEXT,
            accepted INTEGER NOT NULL DEFAULT 1,
            accepted_at TEXT NOT NULL,
            policy_snapshot_json TEXT NOT NULL DEFAULT '{}',
            machine_info_json TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, policy_version)
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS fairness_benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            session_id INTEGER,
            incident_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            detector_family TEXT,
            confidence_score REAL,
            camera_tier TEXT NOT NULL DEFAULT 'unknown',
            lighting_tier TEXT NOT NULL DEFAULT 'unknown',
            speech_env TEXT NOT NULL DEFAULT 'unknown',
            accommodation_flags_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS appeals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id INTEGER NOT NULL,
            requested_by_user_id INTEGER,
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            resolution_note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
            FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS proctoring_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            effective_at TEXT,
            retention_days_by_severity_json TEXT NOT NULL DEFAULT '{}',
            biometric_retention_days INTEGER NOT NULL DEFAULT 30,
            summary_json TEXT NOT NULL DEFAULT '[]',
            is_active INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        )
        '''
    )
    conn.execute('CREATE INDEX IF NOT EXISTS idx_submissions_submission_hash ON submissions(submission_hash)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_biometric_records_session_id ON biometric_records(session_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_incidents_workflow_status ON incidents(workflow_status)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_incidents_assignee ON incidents(assignee)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_incidents_sla_due_at ON incidents(sla_due_at)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_incidents_dedupe_key ON incidents(dedupe_key)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_incidents_evidence_expires_at ON incidents(evidence_expires_at)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_privacy_consents_user_policy ON privacy_consents(user_id, policy_version)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_fairness_benchmarks_created_at ON fairness_benchmarks(created_at DESC)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_fairness_benchmarks_slices ON fairness_benchmarks(camera_tier, lighting_tier, speech_env)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_appeals_incident_id ON appeals(incident_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_proctoring_policies_is_active ON proctoring_policies(is_active)')


def create_schema(conn):
    conn.executescript(
        '''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            email TEXT,
            full_name TEXT NOT NULL,
            student_id TEXT NOT NULL,
            role TEXT NOT NULL,
            department TEXT,
            course TEXT,
            branch TEXT,
            university TEXT,
            location TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS exams (
            id INTEGER PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            duration_minutes INTEGER NOT NULL,
            start_time TEXT,
            end_time TEXT,
            passing_score REAL NOT NULL,
            status TEXT NOT NULL,
            total_questions INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY,
            exam_id INTEGER NOT NULL,
            order_index INTEGER NOT NULL,
            section TEXT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            prompt TEXT NOT NULL,
            difficulty TEXT,
            points REAL NOT NULL DEFAULT 0,
            function_name TEXT,
            languages_json TEXT NOT NULL DEFAULT '[]',
            options_json TEXT NOT NULL DEFAULT '[]',
            examples_json TEXT NOT NULL DEFAULT '[]',
            constraints_json TEXT NOT NULL DEFAULT '[]',
            starter_code_json TEXT NOT NULL DEFAULT '{}',
            correct_option INTEGER,
            explanation TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS question_test_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            input_json TEXT NOT NULL,
            output_json TEXT NOT NULL,
            hidden INTEGER NOT NULL DEFAULT 0,
            description TEXT,
            FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_token TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            exam_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            submitted_at TEXT,
            verification_status TEXT NOT NULL DEFAULT 'pending',
            verification_completed_at TEXT,
            flagged_json TEXT NOT NULL DEFAULT '[]',
            remaining_seconds INTEGER,
            machine_info_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (exam_id) REFERENCES exams(id)
        );

        CREATE TABLE IF NOT EXISTS answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            question_id INTEGER NOT NULL,
            answer_type TEXT NOT NULL,
            selected_option INTEGER,
            code TEXT,
            language TEXT,
            status TEXT,
            test_summary_json TEXT NOT NULL DEFAULT '{}',
            saved_at TEXT NOT NULL,
            UNIQUE (session_id, question_id),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS code_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            question_id INTEGER NOT NULL,
            language TEXT NOT NULL,
            mode TEXT NOT NULL,
            code TEXT NOT NULL,
            status TEXT NOT NULL,
            passed_count INTEGER NOT NULL,
            total_count INTEGER NOT NULL,
            total_time_ms INTEGER NOT NULL,
            runtime_details_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
            FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            exam_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            score REAL NOT NULL DEFAULT 0,
            summary_json TEXT NOT NULL DEFAULT '{}',
            submitted_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (exam_id) REFERENCES exams(id)
        );

        CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            session_id INTEGER,
            type TEXT NOT NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            details_json TEXT NOT NULL DEFAULT '{}',
            confidence_score REAL,
            detector_family TEXT,
            triggered_rules_json TEXT NOT NULL DEFAULT '[]',
            evidence_vector_json TEXT NOT NULL DEFAULT '{}',
            dedupe_key TEXT,
            retention_days INTEGER,
            evidence_expires_at TEXT,
            policy_version TEXT,
            workflow_status TEXT NOT NULL DEFAULT 'new',
            workflow_updated_at TEXT,
            workflow_note TEXT,
            assignee TEXT,
            sla_due_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS appeals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id INTEGER NOT NULL,
            requested_by_user_id INTEGER,
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            resolution_note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
            FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS proctoring_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            effective_at TEXT,
            retention_days_by_severity_json TEXT NOT NULL DEFAULT '{}',
            biometric_retention_days INTEGER NOT NULL DEFAULT 30,
            summary_json TEXT NOT NULL DEFAULT '[]',
            is_active INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS privacy_consents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            policy_version TEXT NOT NULL,
            policy_hash TEXT,
            accepted INTEGER NOT NULL DEFAULT 1,
            accepted_at TEXT NOT NULL,
            policy_snapshot_json TEXT NOT NULL DEFAULT '{}',
            machine_info_json TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, policy_version)
        );

        CREATE TABLE IF NOT EXISTS fairness_benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            session_id INTEGER,
            incident_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            detector_family TEXT,
            confidence_score REAL,
            camera_tier TEXT NOT NULL DEFAULT 'unknown',
            lighting_tier TEXT NOT NULL DEFAULT 'unknown',
            speech_env TEXT NOT NULL DEFAULT 'unknown',
            accommodation_flags_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS biometric_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            biometric_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS model_assets (
            model_id TEXT PRIMARY KEY,
            family TEXT,
            version TEXT,
            github_url TEXT,
            source_url TEXT,
            local_path TEXT,
            status TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            checksum TEXT,
            synced_at TEXT,
            error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_sessions_session_token ON sessions(session_token);
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_exam_id ON sessions(exam_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
        CREATE INDEX IF NOT EXISTS idx_answers_session_id ON answers(session_id);
        CREATE INDEX IF NOT EXISTS idx_answers_question_id ON answers(question_id);
        CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);
        CREATE INDEX IF NOT EXISTS idx_test_cases_question_id ON question_test_cases(question_id);
        CREATE INDEX IF NOT EXISTS idx_submissions_session_id ON submissions(session_id);
        CREATE INDEX IF NOT EXISTS idx_submissions_user_id_exam_id ON submissions(user_id, exam_id);
        CREATE INDEX IF NOT EXISTS idx_incidents_user_id ON incidents(user_id);
        CREATE INDEX IF NOT EXISTS idx_incidents_session_id ON incidents(session_id);
        CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_code_runs_session_id ON code_runs(session_id);
        CREATE INDEX IF NOT EXISTS idx_code_runs_question_id ON code_runs(question_id);
        CREATE INDEX IF NOT EXISTS idx_biometric_records_user_id ON biometric_records(user_id);
        CREATE INDEX IF NOT EXISTS idx_fairness_benchmarks_created_at ON fairness_benchmarks(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_fairness_benchmarks_slices ON fairness_benchmarks(camera_tier, lighting_tier, speech_env);
        CREATE INDEX IF NOT EXISTS idx_appeals_incident_id ON appeals(incident_id);
        CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);
        CREATE INDEX IF NOT EXISTS idx_proctoring_policies_is_active ON proctoring_policies(is_active);
        '''
    )
    run_migrations(conn)
    conn.commit()


def seed_database(conn, seed_path: str):
    seed_file = Path(seed_path or '')
    if not seed_file.exists():
        return False

    with open(seed_file, 'r', encoding='utf-8') as handle:
        seed = json.load(handle)

    inserted_rows = 0

    for user in seed.get('users', []):
        cursor = conn.execute(
            '''
            INSERT INTO users (id, username, password_hash, email, full_name, student_id, role, department, course, branch, university, location)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                password_hash = excluded.password_hash,
                email = excluded.email,
                full_name = excluded.full_name,
                student_id = excluded.student_id,
                role = excluded.role,
                department = excluded.department,
                course = excluded.course,
                branch = excluded.branch,
                university = excluded.university,
                location = excluded.location
            ''',
            (
                user['id'], user['username'], user['passwordHash'], user.get('email'), user['fullName'],
                user['studentId'], user['role'], user.get('department'), user.get('course'),
                user.get('branch'), user.get('university'), user.get('location')
            )
        )
        inserted_rows += cursor.rowcount

    for exam in seed.get('exams', []):
        cursor = conn.execute(
            '''
            INSERT OR IGNORE INTO exams (id, code, name, description, duration_minutes, start_time, end_time, passing_score, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                exam['id'], exam['code'], exam['name'], exam.get('description'), exam['durationMinutes'],
                exam.get('startTime'), exam.get('endTime'), exam.get('passingScore', 0), exam.get('status', 'draft')
            )
        )
        inserted_rows += cursor.rowcount

    for question in seed.get('questions', []):
        cursor = conn.execute(
            '''
            INSERT OR IGNORE INTO questions (
                id, exam_id, order_index, section, type, title, prompt, difficulty, points,
                function_name, languages_json, options_json, examples_json, constraints_json,
                starter_code_json, correct_option, explanation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                question['id'], question['examId'], question['orderIndex'], question.get('section'),
                question['type'], question['title'], question['prompt'], question.get('difficulty'),
                question.get('points', 0), question.get('functionName'), json.dumps(question.get('languages', [])),
                json.dumps(question.get('options', [])), json.dumps(question.get('examples', [])),
                json.dumps(question.get('constraints', [])), json.dumps(question.get('starterCode', {})),
                question.get('correctOption'), question.get('explanation')
            )
        )
        inserted_rows += cursor.rowcount

        # Insert test cases only when the question is newly inserted to avoid duplicates.
        if cursor.rowcount <= 0:
            continue

        for test_case in question.get('testCases', []):
            test_cursor = conn.execute(
                '''
                INSERT INTO question_test_cases (question_id, input_json, output_json, hidden, description)
                VALUES (?, ?, ?, ?, ?)
                ''',
                (
                    question['id'], json.dumps(test_case.get('input', {})), json.dumps(test_case.get('output')),
                    1 if test_case.get('hidden') else 0, test_case.get('description')
                )
            )
            inserted_rows += test_cursor.rowcount

    conn.execute(
        '''
        UPDATE exams
        SET total_questions = (
            SELECT COUNT(*) FROM questions WHERE questions.exam_id = exams.id
        )
        '''
    )
    conn.commit()
    return inserted_rows > 0


def parse_json(value, fallback):
    if not value:
        return fallback
    return json.loads(value)


def normalize_question(row, conn, include_tests=False):
    payload = {
        'id': row['id'],
        'examId': row['exam_id'],
        'orderIndex': row['order_index'],
        'section': row['section'],
        'type': row['type'],
        'title': row['title'],
        'prompt': row['prompt'],
        'difficulty': row['difficulty'],
        'points': row['points'],
        'functionName': row['function_name'],
        'languages': parse_json(row['languages_json'], []),
        'options': parse_json(row['options_json'], []),
        'examples': parse_json(row['examples_json'], []),
        'constraints': parse_json(row['constraints_json'], []),
        'starterCode': parse_json(row['starter_code_json'], {}),
        'correctOption': row['correct_option'],
        'explanation': row['explanation']
    }

    visible_count = conn.execute(
        'SELECT COUNT(*) AS count FROM question_test_cases WHERE question_id = ? AND hidden = 0',
        (row['id'],)
    ).fetchone()['count']
    payload['testCasesVisibleCount'] = visible_count

    total_count = conn.execute(
        'SELECT COUNT(*) AS count FROM question_test_cases WHERE question_id = ?',
        (row['id'],)
    ).fetchone()['count']
    payload['testCasesTotalCount'] = total_count

    if include_tests:
        tests = conn.execute(
            'SELECT * FROM question_test_cases WHERE question_id = ? ORDER BY id',
            (row['id'],)
        ).fetchall()
        payload['testCases'] = [
            {
                'input': parse_json(test['input_json'], {}),
                'output': parse_json(test['output_json'], None),
                'hidden': bool(test['hidden']),
                'description': test['description']
            }
            for test in tests
        ]

    return payload


def serialize_session_answers(conn, session_id):
    rows = conn.execute(
        '''
        SELECT answers.*, questions.type AS question_type
        FROM answers
        JOIN questions ON questions.id = answers.question_id
        WHERE answers.session_id = ?
        ORDER BY questions.order_index
        ''',
        (session_id,)
    ).fetchall()

    answers = {}
    for row in rows:
        question_id = str(row['question_id'])
        if row['answer_type'] == 'mcq':
            answers[question_id] = {
                'type': 'mcq',
                'selectedOption': row['selected_option'],
                'savedAt': row['saved_at']
            }
        else:
            answers[question_id] = {
                'type': 'coding',
                'code': row['code'] or '',
                'language': row['language'],
                'status': row['status'],
                'testSummary': parse_json(row['test_summary_json'], {}),
                'savedAt': row['saved_at']
            }
    return answers


def compute_submission_summary(conn, session_id, flagged_override=None):
    session = conn.execute('SELECT * FROM sessions WHERE id = ?', (session_id,)).fetchone()
    if not session:
        raise ValueError('Session not found')

    exam = conn.execute('SELECT passing_score FROM exams WHERE id = ?', (session['exam_id'],)).fetchone()
    questions = conn.execute(
        'SELECT id, points, type, correct_option FROM questions WHERE exam_id = ? ORDER BY order_index',
        (session['exam_id'],)
    ).fetchall()
    answers = conn.execute('SELECT * FROM answers WHERE session_id = ?', (session_id,)).fetchall()
    answer_map = {row['question_id']: row for row in answers}

    total_points = sum(float(row['points']) for row in questions)
    earned_points = 0.0
    answered = 0

    for question in questions:
        answer = answer_map.get(question['id'])
        if not answer:
            continue
        answered += 1
        if question['type'] == 'mcq':
            if answer['selected_option'] == question['correct_option']:
                earned_points += float(question['points'])
        else:
            summary = parse_json(answer['test_summary_json'], {})
            if summary.get('allPassed'):
                earned_points += float(question['points'])

    total_questions = len(questions)
    flagged = flagged_override if flagged_override is not None else parse_json(session['flagged_json'], [])
    score = round((earned_points / total_points) * 100, 2) if total_points else 0.0

    return {
        'sessionId': session_id,
        'examId': session['exam_id'],
        'answered': answered,
        'unanswered': total_questions - answered,
        'flagged': len(flagged),
        'flaggedQuestionIds': flagged,
        'score': score,
        'earnedPoints': earned_points,
        'totalPoints': total_points,
        'status': 'passed' if score >= float(exam['passing_score'] if exam else 60) else 'submitted',
        'answers': serialize_session_answers(conn, session_id)
    }


def action_init_db(conn, payload, seed_path):
    create_schema(conn)
    seeded = seed_database(conn, seed_path)
    return {
        'seeded': seeded,
        'dbPath': payload.get('dbPath'),
        'counts': {
            'users': conn.execute('SELECT COUNT(*) AS count FROM users').fetchone()['count'],
            'questions': conn.execute('SELECT COUNT(*) AS count FROM questions').fetchone()['count']
        }
    }


def action_login(conn, payload, _seed_path):
    username = str(payload.get('username', '')).strip()
    password = str(payload.get('password', ''))
    row = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()

    if not row or row['password_hash'] != password:
        conn.execute(
            'INSERT INTO incidents (user_id, session_id, type, severity, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (
                row['id'] if row else None,
                None,
                'authentication_failed',
                'high',
                f'Invalid login attempt for {username}',
                json.dumps({'username': username}),
                utc_now()
            )
        )
        conn.commit()
        raise ValueError('Invalid username or password')

    return {
        'userId': row['id'],
        'fullName': row['full_name'],
        'role': row['role'],
        'studentId': row['student_id'],
        'email': row['email'],
        'course': row['course'],
        'branch': row['branch'],
        'university': row['university'],
        'location': row['location']
    }


def action_get_active_exam(conn, payload, _seed_path):
    row = conn.execute(
        'SELECT * FROM exams WHERE status = ? ORDER BY start_time ASC LIMIT 1',
        ('active',)
    ).fetchone()
    if not row:
        action_ensure_active_exam(conn, {}, _seed_path)
        row = conn.execute(
            'SELECT * FROM exams WHERE status = ? ORDER BY start_time ASC LIMIT 1',
            ('active',)
        ).fetchone()
    if not row:
        return None
    return {
        'id': row['id'],
        'code': row['code'],
        'name': row['name'],
        'description': row['description'],
        'durationMinutes': row['duration_minutes'],
        'startTime': row['start_time'],
        'endTime': row['end_time'],
        'passingScore': row['passing_score'],
        'status': row['status'],
        'totalQuestions': row['total_questions']
    }


def action_ensure_active_exam(conn, payload, _seed_path):
    realistic_name = 'Data Structures and Algorithms Mid-Semester Proctored Examination'
    realistic_description = (
        'Institutional proctored assessment covering coding, reasoning, and algorithmic '
        'problem solving under timed conditions.'
    )

    active_row = conn.execute(
        'SELECT id, name, description FROM exams WHERE status = ? ORDER BY start_time ASC, id ASC LIMIT 1',
        ('active',)
    ).fetchone()

    if active_row:
        normalized_name = str(active_row['name'] or '').strip().lower()
        if normalized_name in {
            'secure coding assessment - april 2026',
            'demo exam',
            'test exam',
            'sample exam'
        }:
            conn.execute(
                'UPDATE exams SET name = ?, description = ? WHERE id = ?',
                (realistic_name, realistic_description, active_row['id'])
            )
            conn.commit()

        return {
            'ensured': True,
            'examId': active_row['id'],
            'reused': True
        }

    candidate = conn.execute(
        '''
        SELECT exams.id
        FROM exams
        LEFT JOIN (
            SELECT exam_id, COUNT(*) AS question_count
            FROM questions
            GROUP BY exam_id
        ) AS question_counts ON question_counts.exam_id = exams.id
        ORDER BY COALESCE(question_counts.question_count, 0) DESC,
                 CASE exams.status WHEN 'draft' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
                 exams.id ASC
        LIMIT 1
        '''
    ).fetchone()

    if not candidate:
        if _seed_path:
            seed_database(conn, _seed_path)
            candidate = conn.execute(
                '''
                SELECT exams.id
                FROM exams
                LEFT JOIN (
                    SELECT exam_id, COUNT(*) AS question_count
                    FROM questions
                    GROUP BY exam_id
                ) AS question_counts ON question_counts.exam_id = exams.id
                ORDER BY COALESCE(question_counts.question_count, 0) DESC,
                         CASE exams.status WHEN 'draft' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
                         exams.id ASC
                LIMIT 1
                '''
            ).fetchone()

    if not candidate:
        return {
            'ensured': False,
            'reason': 'no_exam_available'
        }

    now = datetime.now(timezone.utc)
    start_time = (now - timedelta(minutes=45)).replace(microsecond=0).isoformat()
    end_time = (now + timedelta(hours=3, minutes=15)).replace(microsecond=0).isoformat()

    conn.execute('UPDATE exams SET status = ? WHERE status = ?', ('draft', 'active'))
    conn.execute(
        '''
        UPDATE exams
        SET status = ?,
            name = COALESCE(NULLIF(name, ''), ?),
            description = COALESCE(NULLIF(description, ''), ?),
            start_time = ?,
            end_time = ?
        WHERE id = ?
        ''',
        ('active', realistic_name, realistic_description, start_time, end_time, candidate['id'])
    )
    conn.commit()

    return {
        'ensured': True,
        'examId': candidate['id'],
        'reused': False,
        'startTime': start_time,
        'endTime': end_time
    }


def action_get_user_profile(conn, payload, _seed_path):
    row = conn.execute('SELECT * FROM users WHERE id = ?', (payload['userId'],)).fetchone()
    if not row:
        raise ValueError('User profile not found')
    return {
        'userId': row['id'],
        'fullName': row['full_name'],
        'studentId': row['student_id'],
        'role': row['role'],
        'department': row['department'],
        'course': row['course'],
        'branch': row['branch'],
        'university': row['university'],
        'location': row['location']
    }


def action_get_exam_questions(conn, payload, _seed_path):
    rows = conn.execute(
        'SELECT * FROM questions WHERE exam_id = ? ORDER BY order_index',
        (payload['examId'],)
    ).fetchall()
    items = [normalize_question(row, conn, include_tests=True) for row in rows]
    for item in items:
        if item.get('type') == 'coding':
            visible_tests = [test for test in item.get('testCases', []) if not test.get('hidden')]
            item['testCases'] = visible_tests
            item['hiddenTestsCount'] = max(item.get('testCasesTotalCount', 0) - len(visible_tests), 0)
        else:
            item.pop('testCases', None)
    return items


def action_get_question_for_execution(conn, payload, _seed_path):
    row = conn.execute('SELECT * FROM questions WHERE id = ?', (payload['questionId'],)).fetchone()
    if not row:
        raise ValueError('Question not found')
    return normalize_question(row, conn, include_tests=True)


def action_start_exam_session(conn, payload, _seed_path):
    now = utc_now()
    conn.execute(
        '''
        INSERT INTO sessions (session_token, user_id, exam_id, status, started_at, flagged_json, remaining_seconds, machine_info_json)
        VALUES (?, ?, ?, 'active', ?, '[]', ?, ?)
        ''',
        (
            payload['sessionToken'], payload['userId'], payload['examId'], now,
            payload.get('remainingSeconds'), json.dumps(payload.get('machineInfo', {}))
        )
    )
    conn.commit()
    return {
        'sessionId': conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'],
        'sessionToken': payload['sessionToken']
    }


def action_end_exam_session(conn, payload, _seed_path):
    conn.execute(
        'UPDATE sessions SET status = ?, submitted_at = ? WHERE id = ?',
        (payload.get('status', 'completed'), utc_now(), payload['sessionId'])
    )
    conn.commit()
    return {'ended': True}


def action_save_mcq_answer(conn, payload, _seed_path):
    conn.execute(
        '''
        INSERT INTO answers (session_id, question_id, answer_type, selected_option, saved_at)
        VALUES (?, ?, 'mcq', ?, ?)
        ON CONFLICT(session_id, question_id) DO UPDATE SET
            answer_type = 'mcq',
            selected_option = excluded.selected_option,
            saved_at = excluded.saved_at,
            code = NULL,
            language = NULL,
            status = NULL,
            test_summary_json = '{}'
        ''',
        (payload['sessionId'], payload['questionId'], payload['selectedOption'], utc_now())
    )
    conn.commit()
    return {'saved': True}


def action_save_code_answer(conn, payload, _seed_path):
    conn.execute(
        '''
        INSERT INTO answers (session_id, question_id, answer_type, code, language, status, test_summary_json, saved_at)
        VALUES (?, ?, 'coding', ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, question_id) DO UPDATE SET
            answer_type = 'coding',
            code = excluded.code,
            language = excluded.language,
            status = excluded.status,
            test_summary_json = excluded.test_summary_json,
            saved_at = excluded.saved_at,
            selected_option = NULL
        ''',
        (
            payload['sessionId'], payload['questionId'], payload.get('code', ''), payload.get('language'),
            payload.get('status'), json.dumps(payload.get('testSummary', {})), utc_now()
        )
    )
    conn.commit()
    return {'saved': True}


def action_save_code_run(conn, payload, _seed_path):
    conn.execute(
        '''
        INSERT INTO code_runs (session_id, question_id, language, mode, code, status, passed_count, total_count, total_time_ms, runtime_details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            payload.get('sessionId'), payload['questionId'], payload['language'], payload['mode'], payload['code'],
            payload['status'], payload['passedCount'], payload['totalCount'], payload['totalTimeMs'],
            json.dumps(payload.get('runtimeDetails', {})), utc_now()
        )
    )
    conn.commit()
    return {'saved': True}


def action_save_session_progress(conn, payload, _seed_path):
    conn.execute(
        'UPDATE sessions SET flagged_json = ?, remaining_seconds = COALESCE(?, remaining_seconds) WHERE id = ?',
        (json.dumps(payload.get('flaggedQuestionIds', [])), payload.get('remainingSeconds'), payload['sessionId'])
    )
    conn.commit()
    return {'saved': True}


def action_get_session_state(conn, payload, _seed_path):
    session = conn.execute('SELECT * FROM sessions WHERE id = ?', (payload['sessionId'],)).fetchone()
    if not session:
        raise ValueError('Session not found')
    return {
        'sessionId': session['id'],
        'userId': session['user_id'],
        'examId': session['exam_id'],
        'status': session['status'],
        'verificationStatus': session['verification_status'],
        'flaggedQuestionIds': parse_json(session['flagged_json'], []),
        'remainingSeconds': session['remaining_seconds'],
        'answers': serialize_session_answers(conn, session['id'])
    }


def action_save_exam_submission(conn, payload, _seed_path):
    flagged_question_ids = payload.get('flaggedQuestionIds', [])
    session_id = payload['sessionId']

    session = conn.execute('SELECT status FROM sessions WHERE id = ?', (session_id,)).fetchone()
    if not session:
        raise ValueError('Session not found')

    existing_submission = conn.execute(
        'SELECT summary_json, submitted_at, locked_at FROM submissions WHERE session_id = ?',
        (session_id,)
    ).fetchone()

    if existing_submission and (session['status'] == 'completed' or existing_submission['locked_at']):
        summary = parse_json(existing_submission['summary_json'], {})
        summary['submittedAt'] = existing_submission['submitted_at']
        summary['idempotent'] = True
        return summary

    conn.execute('BEGIN IMMEDIATE')
    try:
        conn.execute(
            'UPDATE sessions SET flagged_json = ?, remaining_seconds = ? WHERE id = ?',
            (json.dumps(flagged_question_ids), payload.get('timeRemaining'), session_id)
        )

        summary = compute_submission_summary(conn, session_id, flagged_question_ids)
        submitted_at = utc_now()
        submission_hash = hashlib.sha256(
            json.dumps(
                {
                    'sessionId': session_id,
                    'flaggedQuestionIds': sorted(flagged_question_ids),
                    'answers': summary.get('answers', {})
                },
                sort_keys=True
            ).encode('utf-8')
        ).hexdigest()

        conn.execute(
            '''
            INSERT INTO submissions (session_id, user_id, exam_id, status, score, summary_json, submitted_at, submission_hash, submission_count, locked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                status = excluded.status,
                score = excluded.score,
                summary_json = excluded.summary_json,
                submitted_at = excluded.submitted_at,
                submission_hash = excluded.submission_hash,
                submission_count = submissions.submission_count + 1,
                locked_at = COALESCE(submissions.locked_at, excluded.locked_at)
            ''',
            (
                session_id,
                payload['userId'],
                payload['examId'],
                summary['status'],
                summary['score'],
                json.dumps(summary),
                submitted_at,
                submission_hash,
                1,
                submitted_at
            )
        )

        conn.execute(
            'UPDATE sessions SET status = ?, submitted_at = ?, remaining_seconds = ?, flagged_json = ? WHERE id = ?',
            ('completed', submitted_at, payload.get('timeRemaining'), json.dumps(flagged_question_ids), session_id)
        )
        conn.commit()
        summary['submittedAt'] = submitted_at
        return summary
    except Exception:
        conn.rollback()
        raise


def action_get_submission_summary(conn, payload, _seed_path):
    session_id = payload['sessionId']
    row = conn.execute('SELECT * FROM submissions WHERE session_id = ?', (session_id,)).fetchone()
    if row:
        summary = parse_json(row['summary_json'], {})
        summary['submittedAt'] = row['submitted_at']
        return summary
    return compute_submission_summary(conn, session_id)


def action_get_dashboard_stats(conn, payload, _seed_path):
    active_sessions = conn.execute("SELECT COUNT(*) AS count FROM sessions WHERE status = 'active'").fetchone()['count']
    today_violations = conn.execute('SELECT COUNT(*) AS count FROM incidents').fetchone()['count']
    recent_submissions = conn.execute('SELECT COUNT(*) AS count FROM submissions').fetchone()['count']
    pending_verifications = conn.execute(
        "SELECT COUNT(*) AS count FROM sessions WHERE status = 'active' AND verification_status != 'verified'"
    ).fetchone()['count']
    return {
        'activeSessions': active_sessions,
        'todayViolations': today_violations,
        'recentSubmissions': recent_submissions,
        'pendingVerifications': pending_verifications
    }


def action_get_admin_exams(conn, payload, _seed_path):
    rows = conn.execute(
        '''
        SELECT
            exams.id,
            exams.code,
            exams.name,
            exams.status,
            exams.total_questions,
            exams.duration_minutes,
            exams.passing_score,
            exams.start_time,
            exams.end_time,
            (
                SELECT COUNT(*)
                FROM sessions
                WHERE sessions.exam_id = exams.id AND sessions.status = 'active'
            ) AS active_sessions,
            (
                SELECT COUNT(*)
                FROM submissions
                WHERE submissions.exam_id = exams.id
            ) AS submission_count,
            (
                SELECT ROUND(COALESCE(AVG(submissions.score), 0), 2)
                FROM submissions
                WHERE submissions.exam_id = exams.id
            ) AS average_score,
            (
                SELECT COUNT(*)
                FROM incidents
                JOIN sessions ON sessions.id = incidents.session_id
                WHERE sessions.exam_id = exams.id
            ) AS incident_count
        FROM exams
        ORDER BY
            CASE exams.status WHEN 'active' THEN 0 ELSE 1 END,
            exams.start_time ASC,
            exams.id ASC
        '''
    ).fetchall()
    return [
        {
            'id': row['id'],
            'code': row['code'],
            'name': row['name'],
            'status': row['status'],
            'totalQuestions': row['total_questions'],
            'durationMinutes': row['duration_minutes'],
            'passingScore': row['passing_score'],
            'startTime': row['start_time'],
            'endTime': row['end_time'],
            'activeSessions': row['active_sessions'],
            'submissionCount': row['submission_count'],
            'averageScore': row['average_score'],
            'incidentCount': row['incident_count']
        }
        for row in rows
    ]


def action_get_admin_users(conn, payload, _seed_path):
    rows = conn.execute(
        '''
        SELECT
            users.id,
            users.full_name,
            users.username,
            users.student_id,
            users.role,
            users.course,
            users.branch,
            users.department,
            users.created_at,
            (
                SELECT COUNT(*)
                FROM sessions
                WHERE sessions.user_id = users.id AND sessions.status = 'active'
            ) AS active_sessions,
            (
                SELECT COUNT(*)
                FROM submissions
                WHERE submissions.user_id = users.id
            ) AS submission_count,
            (
                SELECT MAX(sessions.started_at)
                FROM sessions
                WHERE sessions.user_id = users.id
            ) AS last_session_at,
            (
                SELECT COUNT(*)
                FROM incidents
                WHERE incidents.user_id = users.id
            ) AS incident_count
        FROM users
        ORDER BY
            CASE users.role WHEN 'admin' THEN 0 ELSE 1 END,
            users.full_name ASC
        '''
    ).fetchall()
    return [
        {
            'id': row['id'],
            'fullName': row['full_name'],
            'username': row['username'],
            'studentId': row['student_id'],
            'role': row['role'],
            'course': row['course'],
            'branch': row['branch'],
            'department': row['department'],
            'createdAt': row['created_at'],
            'activeSessions': row['active_sessions'],
            'submissionCount': row['submission_count'],
            'lastSessionAt': row['last_session_at'],
            'incidentCount': row['incident_count']
        }
        for row in rows
    ]


def action_get_active_sessions(conn, payload, _seed_path):
    limit = int(payload.get('limit', 100) or 100)
    limit = max(1, min(limit, 500))
    rows = conn.execute(
        '''
        SELECT sessions.id, sessions.session_token, sessions.started_at, sessions.verification_status,
               users.full_name, users.student_id, users.id AS user_id,
               exams.name AS exam_name, exams.code AS exam_code
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        JOIN exams ON exams.id = sessions.exam_id
        WHERE sessions.status = 'active'
        ORDER BY sessions.started_at DESC
        LIMIT ?
        '''
        , (limit,)
    ).fetchall()
    return [
        {
            'sessionId': row['id'],
            'sessionToken': row['session_token'],
            'startedAt': row['started_at'],
            'verificationStatus': row['verification_status'],
            'fullName': row['full_name'],
            'studentId': row['student_id'],
            'userId': row['user_id'],
            'examName': row['exam_name'],
            'examCode': row['exam_code'],
            'status': 'active'
        }
        for row in rows
    ]


def action_get_recent_submissions(conn, payload, _seed_path):
    rows = conn.execute(
        '''
        SELECT submissions.*, users.full_name, users.student_id, exams.name AS exam_name
        FROM submissions
        JOIN users ON users.id = submissions.user_id
        JOIN exams ON exams.id = submissions.exam_id
        ORDER BY submissions.submitted_at DESC
        LIMIT ?
        ''',
        (payload.get('limit', 10),)
    ).fetchall()
    return [
        {
            'submissionId': row['id'],
            'sessionId': row['session_id'],
            'fullName': row['full_name'],
            'studentId': row['student_id'],
            'examName': row['exam_name'],
            'status': row['status'],
            'score': row['score'],
            'submittedAt': row['submitted_at']
        }
        for row in rows
    ]


def action_save_biometric_data(conn, payload, _seed_path):
    now = utc_now()
    session_id = payload.get('sessionId')

    if not session_id:
        session_row = conn.execute(
            'SELECT id FROM sessions WHERE user_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1',
            (payload['userId'], 'active')
        ).fetchone()
        session_id = session_row['id'] if session_row else None

    conn.execute(
        'INSERT INTO biometric_records (session_id, user_id, biometric_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
        (session_id, payload['userId'], payload['biometricType'], json.dumps(payload.get('payload', {})), now)
    )

    if session_id:
        conn.execute(
            'UPDATE sessions SET verification_status = ?, verification_completed_at = ? WHERE id = ? AND status = ?',
            ('verified', now, session_id, 'active')
        )

    conn.commit()
    return {'saved': True, 'sessionId': session_id}


def action_upsert_model_asset(conn, payload, _seed_path):
    conn.execute(
        '''
        INSERT INTO model_assets (model_id, family, version, github_url, source_url, local_path, status, size_bytes, checksum, synced_at, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(model_id) DO UPDATE SET
            family = excluded.family,
            version = excluded.version,
            github_url = excluded.github_url,
            source_url = excluded.source_url,
            local_path = excluded.local_path,
            status = excluded.status,
            size_bytes = excluded.size_bytes,
            checksum = excluded.checksum,
            synced_at = excluded.synced_at,
            error_message = excluded.error_message
        ''',
        (
            payload['modelId'], payload.get('family'), payload.get('version'), payload.get('githubUrl'),
            payload.get('sourceUrl'), payload.get('localPath'), payload.get('status', 'unknown'),
            payload.get('sizeBytes', 0), payload.get('checksum'), payload.get('syncedAt'), payload.get('errorMessage')
        )
    )
    conn.commit()
    return {'saved': True}


def action_get_model_assets(conn, payload, _seed_path):
    rows = conn.execute('SELECT * FROM model_assets ORDER BY model_id').fetchall()
    return [dict(row) for row in rows]


def action_record_incident(conn, payload, _seed_path):
    now = utc_now()
    retention_days = payload.get('retentionDays')
    evidence_expires_at = None
    if retention_days is not None:
      try:
          days_int = int(retention_days)
          if days_int > 0:
              retention_days = days_int
              evidence_expires_at = (datetime.now(timezone.utc) + timedelta(days=days_int)).isoformat()
          else:
              retention_days = None
      except Exception:
          retention_days = None

    conn.execute(
        '''
        INSERT INTO incidents (
            user_id,
            session_id,
            type,
            severity,
            message,
            details_json,
            confidence_score,
            detector_family,
            triggered_rules_json,
            evidence_vector_json,
            dedupe_key,
            retention_days,
            evidence_expires_at,
            policy_version,
            workflow_status,
            workflow_updated_at,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
        ''',
        (
            payload.get('userId'), payload.get('sessionId'), payload['type'], payload.get('severity', 'medium'),
            payload['message'],
            json.dumps(payload.get('details', {})),
            payload.get('confidence'),
            payload.get('detectorFamily'),
            json.dumps(payload.get('triggeredRules', [])),
            json.dumps(payload.get('evidenceVector', {})),
            payload.get('dedupeKey'),
            retention_days,
            evidence_expires_at,
            payload.get('policyVersion'),
            now,
            now
        )
    )
    conn.commit()
    return {'saved': True}


def action_get_recent_incidents(conn, payload, _seed_path):
    rows = conn.execute(
        '''
        SELECT incidents.*, users.full_name, users.student_id, exams.name AS exam_name
        FROM incidents
        LEFT JOIN users ON users.id = incidents.user_id
        LEFT JOIN sessions ON sessions.id = incidents.session_id
        LEFT JOIN exams ON exams.id = sessions.exam_id
        ORDER BY incidents.created_at DESC
        LIMIT ?
        ''',
        (payload.get('limit', 10),)
    ).fetchall()
    return [
        {
            'id': row['id'],
            'userId': row['user_id'],
            'sessionId': row['session_id'],
            'type': row['type'],
            'severity': row['severity'],
            'message': row['message'],
            'createdAt': row['created_at'],
            'fullName': row['full_name'],
            'studentId': row['student_id'],
            'examName': row['exam_name'],
            'workflowStatus': row['workflow_status'] or 'new',
            'workflowUpdatedAt': row['workflow_updated_at'],
            'workflowNote': row['workflow_note'],
            'assignee': row['assignee'],
            'slaDueAt': row['sla_due_at'],
            'confidenceScore': row['confidence_score'],
            'detectorFamily': row['detector_family'],
            'triggeredRules': parse_json(row['triggered_rules_json'], []),
            'evidenceVector': parse_json(row['evidence_vector_json'], {}),
            'dedupeKey': row['dedupe_key'],
            'retentionDays': row['retention_days'],
            'evidenceExpiresAt': row['evidence_expires_at'],
            'policyVersion': row['policy_version'],
            'details': parse_json(row['details_json'], {})
        }
        for row in rows
    ]


def action_save_privacy_consent(conn, payload, _seed_path):
    accepted_at = utc_now()
    conn.execute(
        '''
        INSERT INTO privacy_consents (
            user_id,
            policy_version,
            policy_hash,
            accepted,
            accepted_at,
            policy_snapshot_json,
            machine_info_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, policy_version) DO UPDATE SET
            policy_hash = excluded.policy_hash,
            accepted = excluded.accepted,
            accepted_at = excluded.accepted_at,
            policy_snapshot_json = excluded.policy_snapshot_json,
            machine_info_json = excluded.machine_info_json
        ''',
        (
            payload['userId'],
            payload['policyVersion'],
            payload.get('policyHash'),
            1 if payload.get('accepted', True) else 0,
            accepted_at,
            json.dumps(payload.get('policySnapshot', {})),
            json.dumps(payload.get('machineInfo', {}))
        )
    )
    conn.commit()
    return {
        'saved': True,
        'userId': payload['userId'],
        'policyVersion': payload['policyVersion'],
        'acceptedAt': accepted_at,
        'accepted': bool(payload.get('accepted', True))
    }


def action_get_privacy_consent_status(conn, payload, _seed_path):
    user_id = int(payload.get('userId') or 0)
    if user_id < 1:
        raise ValueError('Invalid user id')

    policy_version = str(payload.get('policyVersion') or '').strip()
    row = None
    if policy_version:
        row = conn.execute(
            'SELECT * FROM privacy_consents WHERE user_id = ? AND policy_version = ? LIMIT 1',
            (user_id, policy_version)
        ).fetchone()
    else:
        row = conn.execute(
            'SELECT * FROM privacy_consents WHERE user_id = ? ORDER BY accepted_at DESC LIMIT 1',
            (user_id,)
        ).fetchone()

    if not row:
        return {
            'exists': False,
            'accepted': False,
            'policyVersion': policy_version or None,
            'acceptedAt': None,
            'policyHash': None
        }

    return {
        'exists': True,
        'accepted': bool(row['accepted']),
        'policyVersion': row['policy_version'],
        'acceptedAt': row['accepted_at'],
        'policyHash': row['policy_hash'],
        'policySnapshot': parse_json(row['policy_snapshot_json'], {})
    }


def action_prune_expired_incident_evidence(conn, payload, _seed_path):
    now = utc_now()
    result = conn.execute(
        '''
        UPDATE incidents
        SET details_json = '{}',
            evidence_vector_json = '{}',
            triggered_rules_json = '[]'
        WHERE evidence_expires_at IS NOT NULL
          AND evidence_expires_at <= ?
          AND (details_json != '{}' OR evidence_vector_json != '{}' OR triggered_rules_json != '[]')
        ''',
        (now,)
    )
    conn.commit()
    return {
        'redactedCount': int(result.rowcount or 0),
        'executedAt': now
    }


def action_record_fairness_benchmark(conn, payload, _seed_path):
    now = utc_now()
    conn.execute(
        '''
        INSERT INTO fairness_benchmarks (
            user_id,
            session_id,
            incident_type,
            severity,
            detector_family,
            confidence_score,
            camera_tier,
            lighting_tier,
            speech_env,
            accommodation_flags_json,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            payload.get('userId'),
            payload.get('sessionId'),
            payload.get('incidentType', 'unknown'),
            payload.get('severity', 'low'),
            payload.get('detectorFamily'),
            payload.get('confidence'),
            payload.get('cameraTier', 'unknown'),
            payload.get('lightingTier', 'unknown'),
            payload.get('speechEnv', 'unknown'),
            json.dumps(payload.get('accommodationFlags', [])),
            now
        )
    )
    conn.commit()
    return {'saved': True, 'createdAt': now}


def action_get_fairness_benchmark_summary(conn, payload, _seed_path):
    limit_days = int(payload.get('limitDays', 30) or 30)
    limit_days = max(1, min(limit_days, 365))
    threshold = (datetime.now(timezone.utc) - timedelta(days=limit_days)).isoformat()

    summary_rows = conn.execute(
        '''
        SELECT
            camera_tier,
            lighting_tier,
            speech_env,
            COUNT(*) AS sample_count,
            SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high_count,
            SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) AS medium_count,
            AVG(COALESCE(confidence_score, 0)) AS avg_confidence
        FROM fairness_benchmarks
        WHERE created_at >= ?
        GROUP BY camera_tier, lighting_tier, speech_env
        ORDER BY sample_count DESC
        LIMIT 50
        ''',
        (threshold,)
    ).fetchall()

    totals = conn.execute(
        '''
        SELECT
            COUNT(*) AS total_samples,
            SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS total_high,
            SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) AS total_medium,
            SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) AS total_low,
            AVG(COALESCE(confidence_score, 0)) AS overall_avg_confidence
        FROM fairness_benchmarks
        WHERE created_at >= ?
        ''',
        (threshold,)
    ).fetchone()

    accommodations = conn.execute(
        '''
        SELECT accommodation_flags_json
        FROM fairness_benchmarks
        WHERE created_at >= ?
        ''',
        (threshold,)
    ).fetchall()

    daily_rows = conn.execute(
        '''
        SELECT
            substr(created_at, 1, 10) AS day,
            COUNT(*) AS sample_count,
            SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high_count,
            AVG(COALESCE(confidence_score, 0)) AS avg_confidence
        FROM fairness_benchmarks
        WHERE created_at >= ?
        GROUP BY substr(created_at, 1, 10)
        ORDER BY day DESC
        LIMIT 14
        ''',
        (threshold,)
    ).fetchall()

    flag_counts = {}
    for row in accommodations:
        flags = parse_json(row['accommodation_flags_json'], [])
        if not isinstance(flags, list):
            continue
        for flag in flags:
            key = str(flag or '').strip()
            if not key:
                continue
            flag_counts[key] = flag_counts.get(key, 0) + 1

    total_samples = int(totals['total_samples'] or 0)
    total_high = int(totals['total_high'] or 0)
    global_high_rate = (total_high / total_samples) if total_samples else 0

    variance_flags = []
    for row in summary_rows:
        sample_count = int(row['sample_count'] or 0)
        high_count = int(row['high_count'] or 0)
        if sample_count < 5:
            continue
        high_rate = high_count / sample_count if sample_count else 0
        if global_high_rate <= 0:
            if high_rate >= 0.25:
                variance_flags.append({
                    'cameraTier': row['camera_tier'],
                    'lightingTier': row['lighting_tier'],
                    'speechEnv': row['speech_env'],
                    'sampleCount': sample_count,
                    'highRate': high_rate,
                    'reason': 'high_rate_without_baseline'
                })
            continue
        if high_rate >= (global_high_rate * 1.6):
            variance_flags.append({
                'cameraTier': row['camera_tier'],
                'lightingTier': row['lighting_tier'],
                'speechEnv': row['speech_env'],
                'sampleCount': sample_count,
                'highRate': high_rate,
                'reason': 'slice_high_rate_outlier'
            })

    return {
        'windowDays': limit_days,
        'totals': {
            'samples': int(totals['total_samples'] or 0),
            'high': int(totals['total_high'] or 0),
            'medium': int(totals['total_medium'] or 0),
            'low': int(totals['total_low'] or 0),
            'avgConfidence': float(totals['overall_avg_confidence'] or 0)
        },
        'accommodationFlags': [
            {'flag': key, 'count': count}
            for key, count in sorted(flag_counts.items(), key=lambda item: item[1], reverse=True)
        ],
        'varianceFlags': variance_flags,
        'dailyRows': [
            {
                'day': row['day'],
                'sampleCount': int(row['sample_count'] or 0),
                'highCount': int(row['high_count'] or 0),
                'highRate': (int(row['high_count'] or 0) / max(1, int(row['sample_count'] or 0))),
                'avgConfidence': float(row['avg_confidence'] or 0)
            }
            for row in daily_rows
        ],
        'sliceRows': [
            {
                'cameraTier': row['camera_tier'],
                'lightingTier': row['lighting_tier'],
                'speechEnv': row['speech_env'],
                'sampleCount': int(row['sample_count'] or 0),
                'highCount': int(row['high_count'] or 0),
                'mediumCount': int(row['medium_count'] or 0),
                'avgConfidence': float(row['avg_confidence'] or 0)
            }
            for row in summary_rows
        ]
    }


def action_update_incident_status(conn, payload, _seed_path):
    incident_id = int(payload.get('incidentId') or 0)
    if incident_id < 1:
        raise ValueError('Invalid incident id')

    next_status = str(payload.get('status') or '').strip().lower()
    allowed_statuses = {'new', 'acknowledged', 'escalated', 'resolved'}
    if next_status not in allowed_statuses:
        raise ValueError('Invalid incident workflow status')

    existing = conn.execute('SELECT id FROM incidents WHERE id = ?', (incident_id,)).fetchone()
    if not existing:
        raise ValueError('Incident not found')

    note = str(payload.get('note') or '').strip()
    assignee_raw = payload.get('assignee')
    assignee = None if assignee_raw is None else str(assignee_raw).strip()
    if assignee == '':
        assignee = None
    sla_due_at_raw = payload.get('slaDueAt')
    sla_due_at = None if sla_due_at_raw is None else str(sla_due_at_raw).strip()
    if sla_due_at == '':
        sla_due_at = None

    now = utc_now()
    conn.execute(
        '''
        UPDATE incidents
        SET workflow_status = ?, workflow_updated_at = ?, workflow_note = ?, assignee = COALESCE(?, assignee), sla_due_at = COALESCE(?, sla_due_at)
        WHERE id = ?
        ''',
        (next_status, now, note if note else None, assignee, sla_due_at, incident_id)
    )
    conn.commit()

    row = conn.execute(
        'SELECT id, workflow_status, workflow_updated_at, workflow_note, assignee, sla_due_at FROM incidents WHERE id = ?',
        (incident_id,)
    ).fetchone()
    return {
        'incidentId': row['id'],
        'workflowStatus': row['workflow_status'],
        'workflowUpdatedAt': row['workflow_updated_at'],
        'workflowNote': row['workflow_note'],
        'assignee': row['assignee'],
        'slaDueAt': row['sla_due_at']
    }


def action_get_appeals(conn, payload, _seed_path):
    limit = int(payload.get('limit', 100) or 100)
    limit = max(1, min(limit, 300))
    status_filter = str(payload.get('status') or '').strip().lower()

    if status_filter:
        rows = conn.execute(
            '''
            SELECT
                appeals.*,
                incidents.type AS incident_type,
                incidents.message AS incident_message,
                incidents.severity AS incident_severity,
                users.full_name AS requested_by_name
            FROM appeals
            JOIN incidents ON incidents.id = appeals.incident_id
            LEFT JOIN users ON users.id = appeals.requested_by_user_id
            WHERE appeals.status = ?
            ORDER BY appeals.updated_at DESC
            LIMIT ?
            ''',
            (status_filter, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            '''
            SELECT
                appeals.*,
                incidents.type AS incident_type,
                incidents.message AS incident_message,
                incidents.severity AS incident_severity,
                users.full_name AS requested_by_name
            FROM appeals
            JOIN incidents ON incidents.id = appeals.incident_id
            LEFT JOIN users ON users.id = appeals.requested_by_user_id
            ORDER BY appeals.updated_at DESC
            LIMIT ?
            ''',
            (limit,)
        ).fetchall()

    return [
        {
            'appealId': row['id'],
            'incidentId': row['incident_id'],
            'requestedByUserId': row['requested_by_user_id'],
            'requestedByName': row['requested_by_name'],
            'reason': row['reason'],
            'status': row['status'],
            'resolutionNote': row['resolution_note'],
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
            'incidentType': row['incident_type'],
            'incidentSeverity': row['incident_severity'],
            'incidentMessage': row['incident_message']
        }
        for row in rows
    ]


def action_create_appeal(conn, payload, _seed_path):
    incident_id = int(payload.get('incidentId') or 0)
    if incident_id < 1:
        raise ValueError('Invalid incident id')

    incident = conn.execute('SELECT id FROM incidents WHERE id = ?', (incident_id,)).fetchone()
    if not incident:
        raise ValueError('Incident not found')

    requested_by_user_id = payload.get('requestedByUserId')
    if requested_by_user_id is not None:
        requested_by_user_id = int(requested_by_user_id)
        if requested_by_user_id < 1:
            requested_by_user_id = None

    reason = str(payload.get('reason') or '').strip()
    if not reason:
        raise ValueError('Appeal reason is required')

    now = utc_now()
    conn.execute(
        '''
        INSERT INTO appeals (incident_id, requested_by_user_id, reason, status, created_at, updated_at)
        VALUES (?, ?, ?, 'open', ?, ?)
        ''',
        (incident_id, requested_by_user_id, reason, now, now)
    )
    conn.commit()

    return {
        'created': True,
        'appealId': conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
    }


def action_update_appeal_status(conn, payload, _seed_path):
    appeal_id = int(payload.get('appealId') or 0)
    if appeal_id < 1:
        raise ValueError('Invalid appeal id')

    next_status = str(payload.get('status') or '').strip().lower()
    allowed = {'open', 'under_review', 'accepted', 'rejected'}
    if next_status not in allowed:
        raise ValueError('Invalid appeal status')

    note = str(payload.get('resolutionNote') or '').strip()
    now = utc_now()

    existing = conn.execute('SELECT id FROM appeals WHERE id = ?', (appeal_id,)).fetchone()
    if not existing:
        raise ValueError('Appeal not found')

    conn.execute(
        '''
        UPDATE appeals
        SET status = ?, resolution_note = ?, updated_at = ?
        WHERE id = ?
        ''',
        (next_status, note if note else None, now, appeal_id)
    )
    conn.commit()

    row = conn.execute(
        'SELECT id, status, resolution_note, updated_at FROM appeals WHERE id = ?',
        (appeal_id,)
    ).fetchone()

    return {
        'appealId': row['id'],
        'status': row['status'],
        'resolutionNote': row['resolution_note'],
        'updatedAt': row['updated_at']
    }


def action_get_proctoring_policies(conn, payload, _seed_path):
    rows = conn.execute(
        '''
        SELECT *
        FROM proctoring_policies
        ORDER BY is_active DESC, effective_at DESC, updated_at DESC
        '''
    ).fetchall()
    return [
        {
            'id': row['id'],
            'version': row['version'],
            'title': row['title'],
            'effectiveAt': row['effective_at'],
            'retentionDaysBySeverity': parse_json(row['retention_days_by_severity_json'], {}),
            'biometricRetentionDays': row['biometric_retention_days'],
            'summary': parse_json(row['summary_json'], []),
            'isActive': bool(row['is_active']),
            'updatedAt': row['updated_at']
        }
        for row in rows
    ]


def action_get_active_proctoring_policy(conn, payload, _seed_path):
    row = conn.execute(
        '''
        SELECT *
        FROM proctoring_policies
        WHERE is_active = 1
        ORDER BY updated_at DESC
        LIMIT 1
        '''
    ).fetchone()
    if not row:
        return None
    return {
        'id': row['id'],
        'version': row['version'],
        'title': row['title'],
        'effectiveAt': row['effective_at'],
        'retentionDaysBySeverity': parse_json(row['retention_days_by_severity_json'], {}),
        'biometricRetentionDays': row['biometric_retention_days'],
        'summary': parse_json(row['summary_json'], []),
        'isActive': bool(row['is_active']),
        'updatedAt': row['updated_at']
    }


def action_save_proctoring_policy(conn, payload, _seed_path):
    version = str(payload.get('version') or '').strip()
    title = str(payload.get('title') or '').strip()
    if not version:
        raise ValueError('Policy version is required')
    if not title:
        raise ValueError('Policy title is required')

    retention = payload.get('retentionDaysBySeverity') or {}
    if not isinstance(retention, dict):
        raise ValueError('Invalid retentionDaysBySeverity')

    summary = payload.get('summary') or []
    if not isinstance(summary, list):
        raise ValueError('Invalid summary')

    biometric_retention_days = int(payload.get('biometricRetentionDays') or 30)
    if biometric_retention_days < 1:
        biometric_retention_days = 30

    effective_at = str(payload.get('effectiveAt') or '').strip() or None
    is_active = 1 if bool(payload.get('isActive')) else 0
    now = utc_now()

    conn.execute(
        '''
        INSERT INTO proctoring_policies (
            version,
            title,
            effective_at,
            retention_days_by_severity_json,
            biometric_retention_days,
            summary_json,
            is_active,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(version) DO UPDATE SET
            title = excluded.title,
            effective_at = excluded.effective_at,
            retention_days_by_severity_json = excluded.retention_days_by_severity_json,
            biometric_retention_days = excluded.biometric_retention_days,
            summary_json = excluded.summary_json,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at
        ''',
        (
            version,
            title,
            effective_at,
            json.dumps(retention),
            biometric_retention_days,
            json.dumps(summary),
            is_active,
            now
        )
    )

    if is_active:
        conn.execute(
            'UPDATE proctoring_policies SET is_active = 0 WHERE version != ? AND is_active = 1',
            (version,)
        )

    conn.commit()
    return {
        'saved': True,
        'version': version,
        'isActive': bool(is_active),
        'updatedAt': now
    }


def action_get_database_status(conn, payload, _seed_path):
    return {
        'connected': True,
        'engine': 'sqlite',
        'mode': 'local',
        'path': payload.get('dbPath'),
        'users': conn.execute('SELECT COUNT(*) AS count FROM users').fetchone()['count'],
        'questions': conn.execute('SELECT COUNT(*) AS count FROM questions').fetchone()['count']
    }


ACTIONS = {
    'init_db': action_init_db,
    'ensure_active_exam': action_ensure_active_exam,
    'login': action_login,
    'get_active_exam': action_get_active_exam,
    'get_user_profile': action_get_user_profile,
    'get_exam_questions': action_get_exam_questions,
    'get_question_for_execution': action_get_question_for_execution,
    'start_exam_session': action_start_exam_session,
    'end_exam_session': action_end_exam_session,
    'save_mcq_answer': action_save_mcq_answer,
    'save_code_answer': action_save_code_answer,
    'save_code_run': action_save_code_run,
    'save_session_progress': action_save_session_progress,
    'get_session_state': action_get_session_state,
    'save_exam_submission': action_save_exam_submission,
    'get_submission_summary': action_get_submission_summary,
    'get_dashboard_stats': action_get_dashboard_stats,
    'get_admin_exams': action_get_admin_exams,
    'get_admin_users': action_get_admin_users,
    'get_active_sessions': action_get_active_sessions,
    'get_recent_submissions': action_get_recent_submissions,
    'save_biometric_data': action_save_biometric_data,
    'upsert_model_asset': action_upsert_model_asset,
    'get_model_assets': action_get_model_assets,
    'record_incident': action_record_incident,
    'get_recent_incidents': action_get_recent_incidents,
    'update_incident_status': action_update_incident_status,
    'get_appeals': action_get_appeals,
    'create_appeal': action_create_appeal,
    'update_appeal_status': action_update_appeal_status,
    'save_privacy_consent': action_save_privacy_consent,
    'get_privacy_consent_status': action_get_privacy_consent_status,
    'prune_expired_incident_evidence': action_prune_expired_incident_evidence,
    'record_fairness_benchmark': action_record_fairness_benchmark,
    'get_fairness_benchmark_summary': action_get_fairness_benchmark_summary,
    'get_proctoring_policies': action_get_proctoring_policies,
    'get_active_proctoring_policy': action_get_active_proctoring_policy,
    'save_proctoring_policy': action_save_proctoring_policy,
    'get_database_status': action_get_database_status,
}


ACTION_ALLOWED_FIELDS = {
    'init_db': set(),
    'ensure_active_exam': set(),
    'login': {'username', 'password'},
    'get_active_exam': set(),
    'get_user_profile': {'userId'},
    'get_exam_questions': {'examId'},
    'get_question_for_execution': {'questionId'},
    'start_exam_session': {'sessionToken', 'userId', 'examId', 'remainingSeconds', 'machineInfo'},
    'end_exam_session': {'sessionId', 'status'},
    'save_mcq_answer': {'sessionId', 'questionId', 'selectedOption'},
    'save_code_answer': {'sessionId', 'questionId', 'code', 'language', 'status', 'testSummary'},
    'save_code_run': {
        'sessionId',
        'questionId',
        'language',
        'mode',
        'code',
        'status',
        'passedCount',
        'totalCount',
        'totalTimeMs',
        'runtimeDetails'
    },
    'save_session_progress': {'sessionId', 'flaggedQuestionIds', 'remainingSeconds'},
    'get_session_state': {'sessionId'},
    'save_exam_submission': {'sessionId', 'userId', 'examId', 'flaggedQuestionIds', 'timeRemaining'},
    'get_submission_summary': {'sessionId'},
    'get_dashboard_stats': set(),
    'get_admin_exams': set(),
    'get_admin_users': set(),
    'get_active_sessions': {'limit'},
    'get_recent_submissions': {'limit'},
    'save_biometric_data': {'userId', 'biometricType', 'sessionId', 'payload'},
    'upsert_model_asset': {
        'modelId',
        'family',
        'version',
        'githubUrl',
        'sourceUrl',
        'localPath',
        'status',
        'sizeBytes',
        'checksum',
        'syncedAt',
        'errorMessage'
    },
    'get_model_assets': set(),
    'record_incident': {
        'userId',
        'sessionId',
        'type',
        'severity',
        'message',
        'details',
        'confidence',
        'detectorFamily',
        'triggeredRules',
        'evidenceVector',
        'dedupeKey',
        'retentionDays',
        'policyVersion'
    },
    'get_recent_incidents': {'limit'},
    'update_incident_status': {'incidentId', 'status', 'note', 'assignee', 'slaDueAt'},
    'get_appeals': {'limit', 'status'},
    'create_appeal': {'incidentId', 'requestedByUserId', 'reason'},
    'update_appeal_status': {'appealId', 'status', 'resolutionNote'},
    'save_privacy_consent': {'userId', 'policyVersion', 'policyHash', 'accepted', 'policySnapshot', 'machineInfo'},
    'get_privacy_consent_status': {'userId', 'policyVersion'},
    'prune_expired_incident_evidence': set(),
    'record_fairness_benchmark': {
        'userId',
        'sessionId',
        'incidentType',
        'severity',
        'detectorFamily',
        'confidence',
        'cameraTier',
        'lightingTier',
        'speechEnv',
        'accommodationFlags'
    },
    'get_fairness_benchmark_summary': {'limitDays'},
    'get_proctoring_policies': set(),
    'get_active_proctoring_policy': set(),
    'save_proctoring_policy': {
        'version',
        'title',
        'effectiveAt',
        'retentionDaysBySeverity',
        'biometricRetentionDays',
        'summary',
        'isActive'
    },
    'get_database_status': set()
}


def sanitize_action_payload(action: str, payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError('Invalid payload object')

    allowed_fields = ACTION_ALLOWED_FIELDS.get(action)
    if allowed_fields is None:
        raise ValueError(f'Unsupported action: {action}')

    unexpected_fields = sorted([key for key in payload.keys() if key not in allowed_fields])
    if unexpected_fields:
        raise ValueError(f'Unexpected payload fields for {action}: {", ".join(unexpected_fields)}')

    return {key: payload[key] for key in allowed_fields if key in payload}


def main():
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument('--db', required=True)
        parser.add_argument('--action', required=True)
        parser.add_argument('--seed', required=False, default='')
        args = parser.parse_args()

        payload = {}
        raw = sys.stdin.read().strip() if 'sys' in globals() else ''
        if raw:
            payload = sanitize_action_payload(args.action, json.loads(raw))
        payload['dbPath'] = args.db

        db_dir = Path(args.db).parent
        db_dir.mkdir(parents=True, exist_ok=True)

        conn = connect(args.db)
        try:
            create_schema(conn)
            handler = ACTIONS.get(args.action)
            if not handler:
                raise ValueError(f'Unsupported action: {args.action}')
            result = handler(conn, payload, args.seed)
            print(json.dumps({'success': True, 'data': result}))
            sys.stdout.flush()
        except Exception as exc:
            conn.rollback()
            raise exc
        finally:
            conn.close()

    except Exception as exc:
        print(json.dumps({'success': False, 'error': str(exc)}))
        sys.stdout.flush()
        sys.exit(0)

if __name__ == '__main__':
    import sys
    main()
